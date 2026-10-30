import { connectDb, eq, users } from "@flitzlink/db";
import { afterAll, expect, test, vi } from "vitest";
import { createApp } from "../src/app.ts";
import {
  type App,
  call,
  cookieOf,
  emailsTo,
  lastEmailTo,
  newClient,
  openEmailLink,
  password,
  signUp,
  testEnv,
  verifiedUser,
} from "./client.ts";

const invitationOnly = { SIGNUP_DOMAINS: undefined, DEFAULT_ROLE: undefined };
const env = await testEnv();
const open = await createApp(env);
const instances = [open];
afterAll(() => Promise.all(instances.map((instance) => instance.close())));

async function instance(environment: Record<string, string | undefined>) {
  const created = await createApp(environment);
  instances.push(created);
  return created.app;
}

function microsoftIdToken(email: string, emailVerified: boolean) {
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ oid: `account-${email}`, email, email_verified: emailVerified, name: "Microsoft User" })}.test`;
}

async function microsoftOAuth(
  app: App,
  {
    endpoint = "/api/auth/link-social",
    cookie = "",
    email,
    emailVerified,
  }: {
    endpoint?: "/api/auth/link-social" | "/api/auth/sign-in/social";
    cookie?: string;
    email: string;
    emailVerified: boolean;
  },
) {
  const linking = endpoint === "/api/auth/link-social";
  const callbackURL = linking ? "http://localhost:3000/app/settings/account?linked=microsoft" : "http://localhost:3000/app";
  const errorCallbackURL = linking ? "http://localhost:3000/app/settings/account" : "http://localhost:3000/app/sign-in";
  const originalFetch = globalThis.fetch;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname.endsWith("/token")) {
      return Response.json({
        access_token: "microsoft-access-token",
        refresh_token: "microsoft-refresh-token",
        token_type: "Bearer",
        expires_in: 3600,
        scope: "openid profile email User.Read offline_access",
        id_token: microsoftIdToken(email, emailVerified),
      });
    }
    if (url.hostname === "graph.microsoft.com") return new Response(null, { status: 404 });
    if (url.hostname === "localhost") return originalFetch(input, init);
    throw new Error(`Unexpected OAuth request to ${url.origin}`);
  });
  try {
    const start = await app.request(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000", ...newClient(), ...(cookie && { cookie }) },
      body: JSON.stringify({ provider: "microsoft", callbackURL, errorCallbackURL }),
    });
    expect(start.status).toBe(200);
    const authorization = new URL((await start.json()).url);
    const cookies = [cookie, cookieOf(start)].filter(Boolean).join("; ");
    const callback = await app.request(
      `/api/auth/callback/microsoft?${new URLSearchParams({ code: "test-code", state: authorization.searchParams.get("state") ?? "" })}`,
      {
        headers: cookies ? { cookie: cookies } : {},
      },
    );
    return callback;
  } finally {
    vi.unstubAllGlobals();
  }
}

function signIn(app: App, email: string, attempt = password, client = newClient()) {
  return app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...client },
    body: JSON.stringify({ email, password: attempt }),
  });
}

async function roles(app: App, cookie: string) {
  const { body } = await call(app, { cookie }, "GET", "/api/users");
  return Object.fromEntries(body.users.map(({ email, role }: { email: string; role: string }) => [email, role]));
}

test("the first verified sign-up becomes admin and later sign-ups need an invitation", async () => {
  const app = await instance(await testEnv(invitationOnly));
  const ada = await verifiedUser(app, "ada-first@example.com");
  expect(await roles(app, ada.cookie)).toEqual({ "ada-first@example.com": "admin" });

  const refused = await signUp(app, "bob-first@example.com");
  expect(refused.status).toBe(403);
  expect((await refused.json()).message).toBe(
    "Sign-up on this instance needs an invitation. Ask an admin of this flitz instance to invite you.",
  );

  const invited = await call(app, { cookie: ada.cookie }, "POST", "/api/users/invitations", {
    email: "bob-first@example.com",
    role: "viewer",
  });
  expect(invited).toMatchObject({ status: 201, body: { email: "bob-first@example.com", role: "viewer" } });
  expect(lastEmailTo("bob-first@example.com")).toContain("http://localhost:3000/app/sign-up?email=bob-first%40example.com");
  const bob = await verifiedUser(app, "bob-first@example.com");
  expect(await roles(app, ada.cookie)).toEqual({ "ada-first@example.com": "admin", "bob-first@example.com": "viewer" });
  expect((await call(app, { cookie: ada.cookie }, "GET", "/api/users")).body.invitations).toEqual([]);
  expect(await call(app, { cookie: bob.cookie }, "GET", "/api/users")).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
});

test("a second sign-up before the first user verifies doesn't become admin", async () => {
  const environment = await testEnv(invitationOnly);
  const app = await instance(environment);
  expect((await signUp(app, "first-pending@example.com")).status).toBe(200);
  const refused = await signUp(app, "second-pending@example.com");
  expect(refused.status).toBe(403);
  expect((await refused.json()).code).toBe("SIGN_UP_NOT_ALLOWED");

  const withDomains = await instance({ ...environment, SIGNUP_DOMAINS: "example.com", DEFAULT_ROLE: "viewer" });
  await verifiedUser(withDomains, "second-pending@example.com");
  const first = cookieOf(await openEmailLink(app, "first-pending@example.com", "Verify"));
  expect(await roles(app, first)).toEqual({ "first-pending@example.com": "admin", "second-pending@example.com": "viewer" });
});

test("an unverified first sign-up older than an hour doesn't block the instance", async () => {
  const environment = await testEnv(invitationOnly);
  const app = await instance(environment);
  const { user } = await (await signUp(app, "stale-first@example.com")).json();
  const db = await connectDb(environment.DATABASE_URL);
  await db
    .update(users)
    .set({ createdAt: new Date(Date.now() - 61 * 60 * 1000) })
    .where(eq(users.id, user.id));
  await db.$client.end();

  const next = await verifiedUser(app, "next-first@example.com");
  expect(await roles(app, next.cookie)).toEqual({ "next-first@example.com": "admin" });
});

test("an ADMIN_EMAILS user who signed up earlier is promoted on the next sign-in", async () => {
  const environment = await testEnv({ DEFAULT_ROLE: "member" });
  const before = await instance(environment);
  const admin = await verifiedUser(before, "admin-promote@example.com");
  await verifiedUser(before, "grace-promote@example.com");
  expect((await roles(before, admin.cookie))["grace-promote@example.com"]).toBe("member");

  const after = await instance({ ...environment, ADMIN_EMAILS: " Grace-Promote@Example.com " });
  expect((await signIn(after, "grace-promote@example.com")).status).toBe(200);
  expect((await roles(after, admin.cookie))["grace-promote@example.com"]).toBe("admin");
});

test("signing up again before verifying sends a new verification link", async () => {
  const app = await instance(await testEnv(invitationOnly));
  expect((await signUp(app, "again@example.com")).status).toBe(200);
  expect((await signUp(app, "again@example.com")).status).toBe(200);
  expect(emailsTo("again@example.com", "Verify")).toHaveLength(2);

  const again = cookieOf(await openEmailLink(app, "again@example.com", "Verify"));
  expect(await roles(app, again)).toEqual({ "again@example.com": "admin" });
  expect((await signUp(app, "again@example.com")).status).toBe(200);
  expect(emailsTo("again@example.com", "Verify")).toHaveLength(2);
});

test("an unverified password user gets no session", async () => {
  const signedUp = await signUp(open.app, "unverified@example.com");
  expect(signedUp.status).toBe(200);
  expect(cookieOf(signedUp)).not.toContain("session_token");

  const signedIn = await signIn(open.app, "unverified@example.com");
  expect(signedIn.status).toBe(403);
  expect(cookieOf(signedIn)).not.toContain("session_token");
  expect(emailsTo("unverified@example.com", "Verify")).toHaveLength(2);
  expect((await open.app.request("/api/links")).status).toBe(401);
});

test("SIGNUP_DOMAINS lets people at a listed domain join with DEFAULT_ROLE and limits the first user to them", async () => {
  const environment = await testEnv({ SIGNUP_DOMAINS: "team.example, other.example", DEFAULT_ROLE: "viewer" });
  const app = await instance(environment);
  const outsider = await signUp(app, "outsider@example.com");
  expect(outsider.status).toBe(403);
  expect((await outsider.json()).code).toBe("SIGN_UP_NOT_ALLOWED");
  const lead = await verifiedUser(app, "lead@team.example");
  await verifiedUser(app, "joiner@team.example");

  const sendMagicLink = (email: string, to = app) =>
    to.request("/api/auth/sign-in/magic-link", {
      method: "POST",
      headers: { "content-type": "application/json", ...newClient() },
      body: JSON.stringify({ email, callbackURL: "/app" }),
    });
  await sendMagicLink("linked@other.example");
  const linked = await openEmailLink(app, "linked@other.example", "Sign in");
  expect(linked.headers.get("location")).toBe("http://localhost:3000/app");
  expect(cookieOf(linked)).toContain("session_token");
  const refusedLink = await sendMagicLink("outsider-link@example.com");
  expect(refusedLink.status).toBe(403);
  expect((await refusedLink.json()).code).toBe("SIGN_UP_NOT_ALLOWED");
  expect(lastEmailTo("outsider-link@example.com")).toBeUndefined();

  const teamOnly = await instance({ ...environment, SIGNUP_DOMAINS: "team.example" });
  expect((await sendMagicLink("linked@other.example", teamOnly)).status).toBe(200);
  expect(emailsTo("linked@other.example", "Sign in")).toHaveLength(2);
  await sendMagicLink("late@other.example");
  const refused = await openEmailLink(teamOnly, "late@other.example", "Sign in");
  expect(refused.headers.get("location")).toContain("error=SIGN_UP_NOT_ALLOWED");
  expect(cookieOf(refused)).not.toContain("session_token");

  expect(await roles(app, lead.cookie)).toEqual({
    "lead@team.example": "admin",
    "joiner@team.example": "viewer",
    "linked@other.example": "viewer",
  });
});

test("ADMIN_EMAILS users become admin, are locked, and switch off the first-user rule", async () => {
  const app = await instance(await testEnv({ ...invitationOnly, ADMIN_EMAILS: "boss@example.com,Deputy@Example.com" }));
  expect((await signUp(app, "stranger@example.com")).status).toBe(403);
  const boss = await verifiedUser(app, "boss@example.com");
  const deputy = await verifiedUser(app, "deputy@example.com");

  const { body } = await call(app, { cookie: boss.cookie }, "GET", "/api/users");
  expect(body.users).toEqual([
    expect.objectContaining({ email: "boss@example.com", role: "admin", emailVerified: true, locked: true }),
    expect.objectContaining({ email: "deputy@example.com", role: "admin", emailVerified: true, locked: true }),
  ]);
  const demoted = await call(app, { cookie: boss.cookie }, "PATCH", `/api/users/${deputy.userId}`, { role: "member" });
  expect(demoted).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
  expect((await call(app, { cookie: boss.cookie }, "DELETE", `/api/users/${deputy.userId}`)).status).toBe(403);
  expect((await call(app, { cookie: boss.cookie }, "PATCH", `/api/users/${deputy.userId}`, { role: "admin" })).status).toBe(200);
  expect((await call(app, { cookie: boss.cookie }, "PATCH", `/api/users/${deputy.userId}`, { name: "Deputy" })).status).toBe(200);
});

test("the last admin can't be demoted or removed", async () => {
  const app = await instance(await testEnv());
  const solo = await verifiedUser(app, "solo@example.com");
  expect((await signUp(app, "pending-admin@example.com")).status).toBe(200);

  const lastAdmin = { status: 409, body: { code: "LAST_ADMIN" } };
  expect(await call(app, { cookie: solo.cookie }, "PATCH", `/api/users/${solo.userId}`, { role: "member" })).toMatchObject(lastAdmin);
  expect(await call(app, { cookie: solo.cookie }, "DELETE", `/api/users/${solo.userId}`)).toMatchObject(lastAdmin);
  expect((await call(app, { cookie: solo.cookie }, "PATCH", `/api/users/${solo.userId}`, { name: "Solo" })).status).toBe(200);
});

test("admins rename other users within the name rules", async () => {
  const app = await instance(await testEnv({ DEFAULT_ROLE: "member" }));
  const admin = await verifiedUser(app, "renamer@example.com");
  const member = await verifiedUser(app, "renamed@example.com");
  const rename = (name: string, cookie = admin.cookie, id = member.userId) => call(app, { cookie }, "PATCH", `/api/users/${id}`, { name });

  expect(await rename("  Ada Lovelace ")).toMatchObject({ status: 200, body: { name: "Ada Lovelace", role: "member" } });
  expect(await rename(" ")).toMatchObject({ status: 400, body: { message: "name: Enter a name." } });
  expect(await rename("x".repeat(101))).toMatchObject({ status: 400, body: { message: "name: Use a name of at most 100 characters." } });
  expect(await call(app, { cookie: admin.cookie }, "PATCH", `/api/users/${member.userId}`, {})).toMatchObject({ status: 400 });
  expect(await rename("Mallory", member.cookie, admin.userId)).toMatchObject({ status: 403, body: { code: "FORBIDDEN" } });
});

test("repeated failed sign-ins from one client get 429 on every replica, while other clients can still try", async () => {
  const replica = await instance(env);
  const client = newClient();
  for (const app of [open.app, replica, open.app])
    expect((await signIn(app, "ada@example.com", "wrong password", client)).status).toBe(401);
  expect((await signIn(replica, "ada@example.com", "wrong password", client)).status).toBe(429);
  expect((await signIn(open.app, "ada@example.com", "wrong password")).status).toBe(401);
});

test("off localhost, flitz refuses to start with the docker compose AUTH_SECRET or a short one", async () => {
  for (const AUTH_SECRET of ["local-only-secret-replace-before-going-public", "too-short"]) {
    await expect(createApp({ ...env, BASE_URL: "https://flitz.example.com", AUTH_SECRET })).rejects.toThrow("openssl rand -base64 32");
  }
  await instance({ ...env, AUTH_SECRET: "local-only-secret-replace-before-going-public" });
});

test("off localhost without SMTP_URL, emails are not logged, only a warning without the link", async () => {
  const warn = vi.spyOn(console, "warn");
  const remote = await instance({ ...env, BASE_URL: "https://flitz.example.com" });
  expect((await signUp(remote, "remote@example.com", { origin: "https://flitz.example.com" })).status).toBe(200);

  expect(lastEmailTo("remote@example.com")).toBeUndefined();
  expect(warn).toHaveBeenCalledWith(
    'SMTP_URL is not set, so flitz did not send the email "Verify your email for flitz" to remote@example.com.',
  );
});

test("the social providers endpoint lists only the providers the instance has configured", async () => {
  const disabled = await open.app.request("/api/auth/sign-in/social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ provider: "microsoft", callbackURL: "http://localhost:3000/app" }),
  });
  expect(disabled.status).toBe(404);
  expect(await (await open.app.request("/api/social-providers")).json()).toEqual([]);

  async function authorization(app: App) {
    const response = await app.request("/api/auth/sign-in/social", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost:3000" },
      body: JSON.stringify({
        provider: "microsoft",
        callbackURL: "http://localhost:3000/app",
        errorCallbackURL: "http://localhost:3000/app/sign-in",
      }),
    });
    expect(response.status).toBe(200);
    return new URL((await response.json()).url);
  }

  const singleTenant = await instance({
    ...env,
    MICROSOFT_CLIENT_ID: "microsoft-client",
    MICROSOFT_CLIENT_SECRET: "microsoft-secret",
    MICROSOFT_TENANT_ID: "tenant-id",
  });
  expect(await (await singleTenant.request("/api/social-providers")).json()).toEqual(["microsoft"]);
  const singleTenantUrl = await authorization(singleTenant);
  expect(singleTenantUrl.origin + singleTenantUrl.pathname).toBe("https://login.microsoftonline.com/tenant-id/oauth2/v2.0/authorize");
  expect(singleTenantUrl.searchParams.get("client_id")).toBe("microsoft-client");
  expect(singleTenantUrl.searchParams.get("redirect_uri")).toBe("http://localhost:3000/api/auth/callback/microsoft");

  const commonTenant = await instance({
    ...env,
    GITHUB_CLIENT_ID: "github-client",
    GITHUB_CLIENT_SECRET: "github-secret",
    MICROSOFT_CLIENT_ID: "microsoft-client",
    MICROSOFT_CLIENT_SECRET: "microsoft-secret",
  });
  expect(await (await commonTenant.request("/api/social-providers")).json()).toEqual(["github", "microsoft"]);
  expect(await (await commonTenant.request("/api/auth-methods")).json()).toEqual({
    password: true,
    socialProviders: ["github", "microsoft"],
  });
  const commonTenantUrl = await authorization(commonTenant);
  expect(commonTenantUrl.pathname).toBe("/common/oauth2/v2.0/authorize");
});

test("a verified user can explicitly connect Microsoft with an unverified matching email", async () => {
  const app = await instance({ ...env, MICROSOFT_CLIENT_ID: "microsoft-client", MICROSOFT_CLIENT_SECRET: "microsoft-secret" });
  const user = await verifiedUser(app, "microsoft-link@example.com");
  const linked = await microsoftOAuth(app, { cookie: user.cookie, email: "microsoft-link@example.com", emailVerified: false });

  expect(linked.status).toBe(302);
  expect(linked.headers.get("location")).toBe("http://localhost:3000/app/settings/account?linked=microsoft");
  const accounts = await call(app, { cookie: user.cookie }, "GET", "/api/auth/list-accounts");
  expect(accounts.body.map(({ providerId }: { providerId: string }) => providerId)).toContain("microsoft");

  const signedIn = await microsoftOAuth(app, {
    endpoint: "/api/auth/sign-in/social",
    email: "microsoft-link@example.com",
    emailVerified: false,
  });
  expect(signedIn.status).toBe(302);
  expect(signedIn.headers.get("location")).toBe("http://localhost:3000/app");
  expect(cookieOf(signedIn)).toContain("session_token");
});

test("social account linking requires a session and matching email", async () => {
  const app = await instance({ ...env, MICROSOFT_CLIENT_ID: "microsoft-client", MICROSOFT_CLIENT_SECRET: "microsoft-secret" });
  const unauthenticated = await app.request("/api/auth/link-social", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "http://localhost:3000" },
    body: JSON.stringify({ provider: "microsoft" }),
  });
  expect(unauthenticated.status).toBe(401);

  const user = await verifiedUser(app, "microsoft-owner@example.com");
  const mismatch = await microsoftOAuth(app, {
    cookie: user.cookie,
    email: "different@example.com",
    emailVerified: true,
  });
  expect(mismatch.status).toBe(302);
  expect(mismatch.headers.get("location")).toContain("error=email_does_not_match");
  const accounts = await call(app, { cookie: user.cookie }, "GET", "/api/auth/list-accounts");
  expect(accounts.body.map(({ providerId }: { providerId: string }) => providerId)).not.toContain("microsoft");
});

test("signed-out Microsoft sign-in can't attach itself to a matching existing account", async () => {
  const app = await instance({ ...env, MICROSOFT_CLIENT_ID: "microsoft-client", MICROSOFT_CLIENT_SECRET: "microsoft-secret" });
  const user = await verifiedUser(app, "microsoft-existing@example.com");
  const signIn = await microsoftOAuth(app, {
    endpoint: "/api/auth/sign-in/social",
    email: "microsoft-existing@example.com",
    emailVerified: true,
  });

  expect(signIn.status).toBe(302);
  expect(signIn.headers.get("location")).toContain("error=account_not_linked");
  expect(cookieOf(signIn)).not.toContain("session_token");
  const accounts = await call(app, { cookie: user.cookie }, "GET", "/api/auth/list-accounts");
  expect(accounts.body.map(({ providerId }: { providerId: string }) => providerId)).not.toContain("microsoft");
});

test("an unverified first-time Microsoft account must verify its email before it gets a session", async () => {
  const app = await instance({ ...env, MICROSOFT_CLIENT_ID: "microsoft-client", MICROSOFT_CLIENT_SECRET: "microsoft-secret" });
  const signIn = await microsoftOAuth(app, {
    endpoint: "/api/auth/sign-in/social",
    email: "microsoft-new@example.com",
    emailVerified: false,
  });

  expect(signIn.status).toBe(302);
  expect(signIn.headers.get("location")).toContain("error=email_not_verified");
  expect(cookieOf(signIn)).not.toContain("session_token");
  expect(lastEmailTo("microsoft-new@example.com", "Verify")).toContain("Verify");
  const verified = await openEmailLink(app, "microsoft-new@example.com", "Verify");
  expect(cookieOf(verified)).toContain("session_token");
  expect((await roles(app, cookieOf(verified)))["microsoft-new@example.com"]).toBe("admin");
});

test("password auth can be disabled while existing accounts and magic-link sign-up still work", async () => {
  const existing = await verifiedUser(open.app, "password-disabled@example.com");
  const app = await instance({ ...env, DISABLE_PASSWORD_AUTH: "true" });
  expect(await (await open.app.request("/api/auth-methods")).json()).toEqual({ password: true, socialProviders: [] });
  expect(await (await app.request("/api/auth-methods")).json()).toEqual({ password: false, socialProviders: [] });
  expect((await signIn(app, "password-disabled@example.com")).status).toBe(400);
  expect((await signUp(app, "disabled-signup@example.com")).status).toBe(400);
  for (const path of ["request-password-reset", "reset-password", "change-password", "set-password"]) {
    expect((await app.request(`/api/auth/${path}`, { method: "POST" })).status).toBe(404);
  }
  expect((await call(app, { cookie: existing.cookie }, "GET", "/api/users")).status).toBe(200);
  for (const email of ["password-disabled@example.com", "new-magic-only@example.com"]) {
    expect((await call(app, {}, "POST", "/api/auth/sign-in/magic-link", { email })).status).toBe(200);
    const signedIn = await openEmailLink(app, email, "Sign in");
    expect(cookieOf(signedIn)).toContain("better-auth.session_token");
    expect((await call(app, { cookie: cookieOf(signedIn) }, "GET", "/api/users")).status).toBe(200);
  }
  const enabled = await instance({ ...env, DISABLE_PASSWORD_AUTH: "false" });
  expect((await signIn(enabled, "password-disabled@example.com")).status).toBe(200);
});
