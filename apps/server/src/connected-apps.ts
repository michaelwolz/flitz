import { and, type Db, desc, eq, oauthAccessTokens, oauthClients, oauthConsents, oauthRefreshTokens, sql, users } from "@flitzlink/db";
import { Hono } from "hono";
import { apiError, handleApiError, type SessionUser } from "./api.ts";
import { scopes, scopesOf } from "./scopes.ts";

export function connectedAppRoutes(db: Db, sessionUser: SessionUser) {
  async function visibleConsents(headers: Headers) {
    const user = await sessionUser(headers);
    if (!user) throw apiError(401, "UNAUTHORIZED", "Sign in to see the apps connected to flitz.");
    return scopesOf(user.role).includes("instance:admin") ? undefined : eq(oauthConsents.userId, user.userId);
  }

  const lastRefresh = sql`(select max(${oauthRefreshTokens.createdAt}) from ${oauthRefreshTokens} where ${oauthRefreshTokens.clientId} = ${oauthConsents.clientId} and ${oauthRefreshTokens.userId} = ${oauthConsents.userId})`;

  const app = new Hono();
  app.onError(handleApiError);

  app.get("/", async (c) => {
    const rows = await db
      .select({
        id: oauthConsents.id,
        clientId: oauthConsents.clientId,
        name: oauthClients.name,
        scopes: oauthConsents.scopes,
        connectedBy: users.name,
        connectedAt: oauthConsents.createdAt,
        lastActiveAt: sql`coalesce(${lastRefresh}, ${oauthConsents.updatedAt})`.mapWith(oauthConsents.updatedAt),
      })
      .from(oauthConsents)
      .innerJoin(oauthClients, eq(oauthClients.clientId, oauthConsents.clientId))
      .innerJoin(users, eq(users.id, oauthConsents.userId))
      .where(await visibleConsents(c.req.raw.headers))
      .orderBy(desc(oauthConsents.createdAt));
    return c.json({
      connectedApps: rows.map((row) => ({
        ...row,
        name: row.name || row.clientId,
        scopes: scopes.filter((scope) => row.scopes.includes(scope)),
      })),
    });
  });

  app.delete("/:id{[0-9a-f-]{36}}", async (c) => {
    const visible = await visibleConsents(c.req.raw.headers);
    const disconnected = await db.transaction(async (tx) => {
      const [consent] = await tx
        .delete(oauthConsents)
        .where(and(visible, eq(oauthConsents.id, c.req.param("id"))))
        .returning();
      if (!consent?.userId) return false;
      for (const tokens of [oauthRefreshTokens, oauthAccessTokens]) {
        await tx.delete(tokens).where(and(eq(tokens.clientId, consent.clientId), eq(tokens.userId, consent.userId)));
      }
      return true;
    });
    if (!disconnected) throw apiError(404, "NOT_FOUND", "This app isn't connected to flitz.");
    return c.body(null, 204);
  });

  return app;
}
