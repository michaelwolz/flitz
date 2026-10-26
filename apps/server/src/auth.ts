import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { mcp } from "@better-auth/mcp";
import {
  accounts,
  and,
  type Db,
  eq,
  gt,
  inArray,
  invitations,
  jwks,
  lt,
  oauthAccessTokens,
  oauthClientAssertions,
  oauthClientResources,
  oauthClients,
  oauthConsents,
  oauthRefreshTokens,
  oauthResources,
  or,
  sessions,
  users,
  verifications,
} from "@flitzlink/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { jwt, magicLink } from "better-auth/plugins";
import nodemailer from "nodemailer";
import { fileURLToPath } from "node:url";
import { type SystemEmail, systemEmail } from "./email.ts";
import { lowercaseList, required } from "./env.ts";
import type { RateLimits } from "./rate-limits.ts";
import { clientIpHeader } from "./redirect-rules.ts";
import { type Role, roles, scopes } from "./scopes.ts";

export const consentPage = "/oauth/consent";

export type Auth = ReturnType<typeof createAuth>;

const composeSecret = "local-only-secret-replace-before-going-public";

function isLoopback(url: string) {
  return /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/.test(new URL(url).hostname);
}

export function assertAuthSecret(env: NodeJS.ProcessEnv) {
  const secret = required(env, "AUTH_SECRET");
  if (isLoopback(required(env, "BASE_URL")) || (secret.length >= 32 && secret !== composeSecret)) return;
  throw new Error(
    "AUTH_SECRET must be a random secret of at least 32 characters when BASE_URL is not localhost. Generate one with `openssl rand -base64 32`.",
  );
}

export const maxNameLength = 100;
const verificationSeconds = 3600;

function assertNameLength(name: unknown) {
  if (typeof name === "string" && name.length > maxNameLength) {
    throw new APIError("BAD_REQUEST", { message: `Use a name of at most ${maxNameLength} characters.` });
  }
}

export function plain(name: string) {
  const clean = name.replace(/[\s\p{C}]+/gu, " ").trim();
  return /[a-z][\w+.-]*:\/\/|www\.|\b[a-z0-9-]+\.[a-z]{2,}\b/i.test(clean) ? "" : clean;
}

export function createAuth(
  db: Db,
  env: NodeJS.ProcessEnv,
  authRateLimit: RateLimits["auth"],
  sendEmail: Mailer,
  adminEmails: string[],
  fetchClientMetadata = fetchClientMetadataResource,
) {
  const baseURL = required(env, "BASE_URL");
  const host = new URL(baseURL).host;
  const signUpDomains = lowercaseList(env, "SIGNUP_DOMAINS");
  const defaultRole = (env.DEFAULT_ROLE || "member") as Role;
  if (!roles.includes(defaultRole)) throw new Error(`DEFAULT_ROLE must be one of ${roles.join(", ")}`);

  async function roleFor(email: string): Promise<Role> {
    const address = email.toLowerCase();
    const atSignUpDomain = signUpDomains.includes(address.split("@").at(-1)!);
    if (adminEmails.includes(address)) return "admin";
    if (!adminEmails.length && (!signUpDomains.length || atSignUpDomain)) {
      const staleBefore = new Date(Date.now() - verificationSeconds * 1000);
      const [someone] = await db
        .select({ id: users.id })
        .from(users)
        .where(or(eq(users.emailVerified, true), gt(users.createdAt, staleBefore)))
        .limit(1);
      if (!someone) {
        await db.delete(users).where(and(eq(users.emailVerified, false), lt(users.createdAt, staleBefore)));
        return "admin";
      }
    }
    const [invitation] = await db
      .select({ role: invitations.role })
      .from(invitations)
      .where(and(eq(invitations.email, address), gt(invitations.expiresAt, new Date())));
    if (invitation) return invitation.role as Role;
    if (atSignUpDomain) return defaultRole;
    throw new APIError("FORBIDDEN", {
      code: "SIGN_UP_NOT_ALLOWED",
      message: "Sign-up on this instance needs an invitation. Ask an admin of this flitz instance to invite you.",
    });
  }

  async function revokeOAuthGrants(userId: string) {
    await db.transaction(async (tx) => {
      for (const table of [oauthConsents, oauthAccessTokens, oauthRefreshTokens]) await tx.delete(table).where(eq(table.userId, userId));
    });
  }

  const auth = betterAuth({
    secret: required(env, "AUTH_SECRET"),
    baseURL,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        jwks,
        oauthClient: oauthClients,
        oauthResource: oauthResources,
        oauthClientResource: oauthClientResources,
        oauthRefreshToken: oauthRefreshTokens,
        oauthAccessToken: oauthAccessTokens,
        oauthConsent: oauthConsents,
        oauthClientAssertion: oauthClientAssertions,
      },
    }),
    advanced: { database: { generateId: "uuid" }, ipAddress: { ipAddressHeaders: [clientIpHeader] } },
    rateLimit: { enabled: true, customStorage: authRateLimit },
    onAPIError: { customizeDefaultErrorPage: {} },
    disabledPaths: ["/oauth2/delete-consent"],
    user: { additionalFields: { role: { type: "string", input: false, defaultValue: "member" } } },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 3600,
      sendResetPassword: async ({ user, token }) =>
        sendEmail(
          user.email,
          "Reset your flitz password",
          systemEmail({
            heading: "Reset your password",
            intro: `Set a new password for your flitz account on ${host}.`,
            actionLabel: "Reset password",
            actionUrl: `${baseURL}/app/reset-password?token=${token}`,
            details: [
              "You get this email because someone asked to reset the password for this address. The link works once, for 1 hour. A new password signs you out everywhere and disconnects the apps you connected via MCP.",
              "If you didn't ask for this, ignore this email. Your password stays as it is.",
            ],
            host,
          }),
        ),
      onPasswordReset: ({ user }) => revokeOAuthGrants(user.id),
      onExistingUserSignUp: async ({ user }, request) => {
        if (user.emailVerified) return;
        const body = await request?.json().catch(() => undefined);
        await auth.api.sendVerificationEmail({ body: { email: user.email, callbackURL: body?.callbackURL } });
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      expiresIn: verificationSeconds,
      sendVerificationEmail: async ({ user, url }) =>
        sendEmail(
          user.email,
          "Verify your email for flitz",
          systemEmail({
            heading: "Verify your email",
            intro: `Confirm your email address for flitz on ${host}.`,
            actionLabel: "Verify email",
            actionUrl: url,
            details: [
              `You get this email because an account on ${host} uses this address. The link confirms that the address is yours and signs you in. It works for 1 hour.`,
              "If you didn't create this account, ignore this email.",
            ],
            host,
          }),
        ),
      autoSignInAfterVerification: true,
    },
    socialProviders: {
      ...(env.GOOGLE_CLIENT_ID
        ? {
            google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: required(env, "GOOGLE_CLIENT_SECRET"), requireEmailVerification: true },
          }
        : {}),
      ...(env.GITHUB_CLIENT_ID
        ? {
            github: { clientId: env.GITHUB_CLIENT_ID, clientSecret: required(env, "GITHUB_CLIENT_SECRET"), requireEmailVerification: true },
          }
        : {}),
      ...(env.MICROSOFT_CLIENT_ID
        ? {
            microsoft: {
              clientId: env.MICROSOFT_CLIENT_ID,
              clientSecret: required(env, "MICROSOFT_CLIENT_SECRET"),
              tenantId: env.MICROSOFT_TENANT_ID || "common",
              requireEmailVerification: true,
            },
          }
        : {}),
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (!["/sign-up/email", "/sign-in/magic-link"].includes(ctx.path) || typeof ctx.body?.email !== "string") return;
        const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, ctx.body.email.toLowerCase()));
        if (!existing) await roleFor(ctx.body.email);
      }),
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            assertNameLength(user.name);
            return { data: { role: await roleFor(user.email) } };
          },
          after: async (user) => {
            await db.delete(invitations).where(eq(invitations.email, user.email));
          },
        },
        update: { before: async (user) => assertNameLength(user.name) },
      },
      session: {
        create: {
          before: async (session) => {
            if (!adminEmails.length) return;
            await db
              .update(users)
              .set({ role: "admin" })
              .where(and(eq(users.id, session.userId), eq(users.emailVerified, true), inArray(users.email, adminEmails)));
          },
        },
      },
    },
    plugins: [
      magicLink({
        expiresIn: 300,
        sendMagicLink: async ({ email, url }) =>
          sendEmail(
            email,
            "Sign in to flitz",
            systemEmail({
              heading: "Sign in to flitz",
              intro: `Sign in to flitz on ${host}.`,
              actionLabel: "Sign in",
              actionUrl: url,
              details: [
                "You get this email because someone asked for a sign-in link for this address. The link works once, for 5 minutes.",
                "If you didn't ask for this, ignore this email. Nobody can sign in without the link.",
              ],
              host,
            }),
          ),
      }),
      jwt({ disableSettingJwtHeader: true }),
      mcp({
        resource: new URL("/api/mcp", baseURL).href,
        scopes: [...scopes, "offline_access"],
        grantTypes: ["authorization_code", "refresh_token"],
        loginPage: "/app/sign-in",
        consentPage,
      }),
      cimd({ fetchClientMetadataResource: fetchClientMetadata, metadataProfile: "mcp-2026-07-28" }),
    ],
  });
  return auth;
}

export type Mailer = ReturnType<typeof createMailer>;

export function createMailer(env: NodeJS.ProcessEnv) {
  const local = isLoopback(required(env, "BASE_URL"));
  if (!env.SMTP_URL) {
    return (to: string, subject: string, message: SystemEmail) =>
      local
        ? console.log(`Email to ${to}: ${subject}\n${message.text}`)
        : console.warn(`SMTP_URL is not set, so flitz did not send the email "${subject}" to ${to}.`);
  }
  const from = required(env, "SMTP_FROM");
  const transport = nodemailer.createTransport(env.SMTP_URL);
  const logo = fileURLToPath(new URL("../../../docs/brand/flitz-lockup-light.png", import.meta.url));
  return (to: string, subject: string, message: SystemEmail) => {
    transport
      .sendMail({
        from,
        to,
        subject,
        ...message,
        attachments: [{ filename: "flitz-lockup-light.png", path: logo, cid: "flitz-lockup-light" }],
      })
      .catch((error) => console.error(`Email to ${to} failed:`, error));
  };
}
