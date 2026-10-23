import { clicks, type Db, eq, links } from "@flitzlink/db";
import { Hono } from "hono";
import { apiError, handleApiError, type SessionUser } from "./api.ts";
import { linkNotFound } from "./links.ts";
import { scopesOf } from "./scopes.ts";

/** Deletes a deactivated link with its clicks, for admins signed in to the web app only, so no API key or agent can. */
export function linkDeletionRoutes(db: Db, sessionUser: SessionUser) {
  return new Hono().onError(handleApiError).delete("/:id{[0-9a-f-]{36}}", async (c) => {
    const user = await sessionUser(c.req.raw.headers);
    if (!user) throw apiError(401, "UNAUTHORIZED", "Sign in to delete links.");
    if (!scopesOf(user.role).includes("instance:admin"))
      throw apiError(403, "FORBIDDEN", "Only admins delete links. Ask an admin to do this.");
    const id = c.req.param("id");
    await db.transaction(async (tx) => {
      const [link] = await tx.select({ active: links.active }).from(links).where(eq(links.id, id)).for("update");
      if (!link) throw linkNotFound();
      if (link.active) throw apiError(409, "LINK_ACTIVE", "Deactivate the link before you delete it.");
      await tx.delete(clicks).where(eq(clicks.linkId, id));
      await tx.delete(links).where(eq(links.id, id));
    });
    return c.body(null, 204);
  });
}
