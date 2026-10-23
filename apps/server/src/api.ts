import { createHash } from "node:crypto";
import { and, apiKeys, type Db, eq, oauthConsents, users } from "@flitzlink/db";
import { type Hook, type OpenAPIRoute, type RouteConfig, z } from "@hono/zod-openapi";
import { verifyJwsAccessToken } from "better-auth/oauth2";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { Auth } from "./auth.ts";
import { type Scope, scopesOf } from "./scopes.ts";

export type ApiEnv = { Variables: { userId: string } };

export function apiRoute<R extends RouteConfig & { operationId: string }>(definition: OpenAPIRoute<R, ApiEnv> & { scope: Scope }) {
  return definition;
}

export function jsonBody<T extends z.ZodType>(schema: T) {
  return { required: true, content: { "application/json": { schema } } };
}

export function jsonResponse<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { "application/json": { schema } } };
}

export const limitParam = z.coerce
  .number({ error: "Choose a limit from 1 to 100." })
  .int()
  .min(1)
  .max(100)
  .default(50)
  .meta({ description: "The most rows to return, from 1 to 100." });

export function apiError(status: ContentfulStatusCode, code: string, message: string) {
  return new HTTPException(status, { res: Response.json({ code, message }, { status }) });
}

export const handleApiError: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.res ?? c.json({ code: "INVALID_REQUEST", message: error.message }, error.status);
  console.error(error);
  return c.json({ code: "INTERNAL_ERROR", message: "Something went wrong on this instance. Try again in a moment." }, 500);
};

export function invalidRequest({ issues }: z.ZodError) {
  const messages = issues.map(({ path, message }) => `${path.length ? `${path.join(".")}: ` : ""}${message.replace(/\.?$/, ".")}`);
  return apiError(400, "INVALID_REQUEST", messages.join(" "));
}

export const validationHook: Hook<unknown, any, string, undefined> = (result) => {
  if (!result.success) throw invalidRequest(result.error);
};

const unsafeMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function sameOriginOnly(origin: string): MiddlewareHandler {
  return async (c, next) => {
    const site = c.req.header("sec-fetch-site");
    const from = c.req.header("origin");
    const signedIn = c.req.header("cookie") !== undefined && !/^Bearer /i.test(c.req.header("authorization") ?? "");
    if (unsafeMethods.has(c.req.method) && signedIn && ((site && site !== "same-origin") || (from && from !== origin))) {
      throw apiError(403, "FORBIDDEN", `This request came from another site, so flitz refused it. Use flitz at ${origin}.`);
    }
    await next();
  };
}

export function hashApiKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

export type SessionUser = ReturnType<typeof authorizer>["sessionUser"];

export function authorizer(db: Db, auth: Auth, baseUrl: string) {
  const verifyOptions = { issuer: new URL("/api/auth", baseUrl).href, audience: new URL("/api/mcp", baseUrl).href, typ: "at+jwt" };
  const jwksCacheKey = {};

  async function sessionUser(headers: Headers) {
    const session = await auth.api.getSession({ headers });
    return session ? { userId: session.user.id, role: session.user.role } : undefined;
  }

  async function oauthAccess(token: string) {
    const claims = await verifyJwsAccessToken(token, { jwksFetch: () => auth.api.getJwks(), jwksCacheKey, verifyOptions }).catch(
      () => undefined,
    );
    if (!claims?.sub || claims.cnf || typeof claims.scope !== "string" || typeof claims.azp !== "string") {
      throw apiError(401, "UNAUTHORIZED", "This access token is not valid or has expired. Connect flitz again.");
    }
    const [grant] = await db
      .select({ connectedAt: oauthConsents.createdAt, role: users.role })
      .from(oauthConsents)
      .innerJoin(users, eq(users.id, oauthConsents.userId))
      .where(and(eq(oauthConsents.clientId, claims.azp), eq(oauthConsents.userId, claims.sub)));
    if (!grant || Math.floor(grant.connectedAt.getTime() / 1000) > (claims.iat ?? 0)) {
      throw apiError(401, "UNAUTHORIZED", "This app was disconnected from flitz. Connect flitz again.");
    }
    const allowed = scopesOf(grant.role);
    return {
      userId: claims.sub,
      scopes: claims.scope.split(" ").filter((scope) => allowed.includes(scope as Scope)),
      role: grant.role,
    };
  }

  async function access(headers: Headers) {
    const token = headers.get("authorization")?.match(/^Bearer (.+)$/i)?.[1];
    if (token && !token.startsWith("flitz_")) return oauthAccess(token);
    if (token) {
      const [apiKey] = await db
        .select({ userId: apiKeys.createdBy, scopes: apiKeys.scopes, creatorRole: users.role })
        .from(apiKeys)
        .innerJoin(users, eq(users.id, apiKeys.createdBy))
        .where(eq(apiKeys.keyHash, hashApiKey(token)));
      if (!apiKey) throw apiError(401, "UNAUTHORIZED", "This API key is not valid. Check it, or create a new one.");
      const creatorScopes: readonly string[] = scopesOf(apiKey.creatorRole);
      if (apiKey.scopes.some((scope) => !creatorScopes.includes(scope))) {
        throw apiError(
          403,
          "FORBIDDEN",
          "The user who created this API key no longer has a role that allows all of its scopes, so it no longer works. Ask an admin for a new key.",
        );
      }
      return { userId: apiKey.userId, scopes: apiKey.scopes, role: undefined };
    }
    const user = await sessionUser(headers);
    if (!user) throw apiError(401, "UNAUTHORIZED", "Sign in, or send an API key in the Authorization header: Bearer flitz_...");
    return { ...user, scopes: scopesOf(user.role) };
  }

  const authorize =
    (scope: Scope): MiddlewareHandler<ApiEnv> =>
    async (c, next) => {
      const { userId, scopes, role } = await access(c.req.raw.headers);
      if (!scopes.includes(scope)) {
        throw apiError(
          403,
          "FORBIDDEN",
          !role
            ? `This API key lacks the ${scope} scope. Create a key that has it.`
            : scopesOf(role).includes(scope)
              ? `This connection wasn't granted the ${scope} scope. Connect flitz again and allow it.`
              : `Your role (${role}) doesn't include the ${scope} scope. Ask an admin to do this, or to give you a role that can.`,
        );
      }
      c.set("userId", userId);
      await next();
    };

  return { access, authorize, sessionUser };
}
