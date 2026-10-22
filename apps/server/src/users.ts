import { and, asc, type Db, eq, invitations, users } from "@flitzlink/db";
import { z } from "@hono/zod-openapi";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { apiError, handleApiError, invalidRequest } from "./api.ts";
import { type Auth, type Mailer, paragraphs, plain } from "./auth.ts";
import { type Role, roles, scopesOf } from "./scopes.ts";

export type UserRow = { id: string; name: string; email: string; role: Role; emailVerified: boolean; createdAt: string; locked: boolean };
export type InvitationRow = { id: string; email: string; role: Role; expiresAt: string };

const invitationHours = 48;

const role = z.enum(roles, { error: `Choose one of the roles ${roles.join(", ")}.` });

function json<T extends z.ZodType>(schema: T) {
  return validator("json", (value): z.infer<T> => {
    const result = schema.safeParse(value);
    if (!result.success) throw invalidRequest(result.error);
    return result.data;
  });
}

/** Users and invitations, for admins signed in to the web app only. */
export function userRoutes(db: Db, auth: Auth, baseUrl: string, adminEmails: string[], sendEmail: Mailer) {
  const host = new URL(baseUrl).host;

  const toUserRow = (user: typeof users.$inferSelect): UserRow => ({
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role as Role,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
    locked: adminEmails.includes(user.email),
  });
  const toInvitationRow = (invitation: typeof invitations.$inferSelect): InvitationRow => ({
    id: invitation.id,
    email: invitation.email,
    role: invitation.role as Role,
    expiresAt: invitation.expiresAt.toISOString(),
  });

  /** Changes a user's role, or removes them without a role, keeping at least one verified admin. */
  function changeUser(id: string, newRole?: Role) {
    return db.transaction(async (tx) => {
      const verifiedAdmins = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.role, "admin"), eq(users.emailVerified, true)))
        .orderBy(asc(users.id))
        .for("update");
      const [user] = await tx.select().from(users).where(eq(users.id, id));
      if (!user) throw apiError(404, "NOT_FOUND", "This user does not exist.");
      if (adminEmails.includes(user.email) && newRole !== "admin") {
        throw apiError(
          403,
          "FORBIDDEN",
          `${user.email} is listed in ADMIN_EMAILS, so you can only make them admin, not remove them or give them another role. Remove them from ADMIN_EMAILS first.`,
        );
      }
      if (newRole !== "admin" && verifiedAdmins.length === 1 && verifiedAdmins[0].id === id) {
        throw apiError(409, "LAST_ADMIN", "flitz needs at least one admin. Make another user admin first.");
      }
      const [changed] = newRole
        ? await tx.update(users).set({ role: newRole }).where(eq(users.id, id)).returning()
        : await tx.delete(users).where(eq(users.id, id)).returning();
      return toUserRow(changed);
    });
  }

  return new Hono<{ Variables: { admin: { name: string; email: string; id: string } } }>()
    .onError(handleApiError)
    .use(async (c, next) => {
      const session = await auth.api.getSession({ headers: c.req.raw.headers });
      if (!session) throw apiError(401, "UNAUTHORIZED", "Sign in to manage users.");
      if (!scopesOf(session.user.role).includes("instance:admin")) {
        throw apiError(403, "FORBIDDEN", "Only admins manage users. Ask an admin to do this.");
      }
      c.set("admin", session.user);
      await next();
    })
    .get("/", async (c) => {
      const [userRows, invitationRows] = await Promise.all([
        db.select().from(users).orderBy(asc(users.createdAt), asc(users.id)),
        db.select().from(invitations).orderBy(asc(invitations.createdAt), asc(invitations.id)),
      ]);
      return c.json({ users: userRows.map(toUserRow), invitations: invitationRows.map(toInvitationRow) });
    })
    .patch("/:id{[0-9a-f-]{36}}", json(z.strictObject({ role })), async (c) =>
      c.json(await changeUser(c.req.param("id"), c.req.valid("json").role)),
    )
    .delete("/:id{[0-9a-f-]{36}}", async (c) => {
      await changeUser(c.req.param("id"));
      return c.body(null, 204);
    })
    .post(
      "/invitations",
      json(z.strictObject({ email: z.string().trim().toLowerCase().pipe(z.email("Enter an email address, like ada@example.com.")), role })),
      async (c) => {
        const { email, role } = c.req.valid("json");
        const { admin } = c.var;
        const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
        if (user) throw apiError(409, "USER_EXISTS", `${email} already has an account on this instance. Change their role instead.`);
        const values = { role, invitedBy: admin.id, expiresAt: new Date(Date.now() + invitationHours * 3600 * 1000) };
        const [invitation] = await db
          .insert(invitations)
          .values({ email, ...values })
          .onConflictDoUpdate({ target: invitations.email, set: values })
          .returning();
        const name = plain(admin.name) || admin.email;
        const sender = name === admin.email ? name : `${name} (${admin.email})`;
        sendEmail(
          email,
          `You're invited to flitz on ${host}`,
          paragraphs(
            `${sender} invited you to flitz on ${host}, with the role ${role}. Create your account with this email address here:`,
            `${baseUrl}/app/sign-up?email=${encodeURIComponent(email)}`,
            `You get this email because ${name} entered your address. The invitation works for ${invitationHours} hours.`,
            `If you don't know ${name} or didn't expect this invitation, ignore this email. Nothing happens unless you sign up.`,
          ),
        );
        return c.json(toInvitationRow(invitation), 201);
      },
    )
    .delete("/invitations/:id{[0-9a-f-]{36}}", async (c) => {
      const [invitation] = await db
        .delete(invitations)
        .where(eq(invitations.id, c.req.param("id")))
        .returning({ id: invitations.id });
      if (!invitation) throw apiError(404, "NOT_FOUND", "This invitation does not exist.");
      return c.body(null, 204);
    });
}
