import { asc, type Db, domains, eq, links } from "@flitzlink/db";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, apiRoute, jsonBody, jsonResponse } from "./api.ts";
import { httpUrl } from "./links.ts";

const Domain = z
  .object({
    id: z.string(),
    hostname: z.string(),
    fallbackUrl: z.string().nullable(),
    createdAt: z.string(),
  })
  .openapi("Domain");
export type Domain = z.infer<typeof Domain>;

const fallbackUrl = httpUrl.nullable().meta({
  description: "Where the domain sends visitors whose slug is unknown or belongs to a deactivated link. `null` shows the not-found page.",
  example: "https://example.com",
});

const domainParams = z.object({
  id: z
    .uuid({ error: "Use the domain's id from addDomain or listDomains, not its hostname." })
    .meta({ description: "The domain's `id`, as `addDomain` and `listDomains` return it. Not its hostname." }),
});

function toJson(domain: typeof domains.$inferSelect) {
  return { id: domain.id, hostname: domain.hostname, fallbackUrl: domain.fallbackUrl, createdAt: domain.createdAt.toISOString() };
}

export function domainRoutes(db: Db, baseUrl: string) {
  const host = new URL(baseUrl).hostname;
  const pointAtInstance = `add a CNAME record for the hostname that points to ${host} (for an apex domain such as example.com, which can't have a CNAME record, use an ALIAS or ANAME record, or A/AAAA records with the addresses of ${host}), so visitors of its short URLs reach this instance`;

  async function findDomain(id: string) {
    const [domain] = await db.select().from(domains).where(eq(domains.id, id));
    if (!domain) throw domainNotFound();
    return domain;
  }

  return [
    apiRoute({
      scope: "domains:write",
      route: createRoute({
        method: "post",
        path: "/domains",
        operationId: "addDomain",
        summary: "Add a custom domain",
        description: `Adds a custom domain. It serves its short URLs as soon as DNS points it at this instance: ${pointAtInstance}.`,
        request: {
          body: jsonBody(
            z.strictObject({
              hostname: z
                .string()
                .trim()
                .toLowerCase()
                .max(253, "Use a hostname of at most 253 characters.")
                .regex(
                  /^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]([a-z0-9-]*[a-z0-9])?$/,
                  "Enter a hostname like go.example.com, without https:// or a path.",
                )
                .meta({
                  description: "The domain's hostname, like go.example.com, without https:// or a path.",
                  example: "go.example.com",
                }),
              fallbackUrl: fallbackUrl.optional(),
            }),
          ),
        },
        responses: { 201: jsonResponse("The new domain", Domain) },
      }),
      handler: async (c) => {
        const { hostname, fallbackUrl } = c.req.valid("json");
        if (hostname === host) {
          throw apiError(400, "DOMAIN_NOT_ALLOWED", `${hostname} is the instance domain. Add a domain of your own.`);
        }
        const [domain] = await db.insert(domains).values({ hostname, fallbackUrl }).onConflictDoNothing().returning();
        if (!domain) throw apiError(409, "DOMAIN_TAKEN", `${hostname} is already a custom domain of this instance.`);
        return c.json(toJson(domain), 201);
      },
    }),
    apiRoute({
      scope: "links:read",
      route: createRoute({
        method: "get",
        path: "/domains",
        operationId: "listDomains",
        summary: "List custom domains",
        description: "Lists the custom domains.",
        responses: { 200: jsonResponse("The custom domains", z.object({ domains: z.array(Domain) })) },
      }),
      handler: async (c) => {
        const rows = await db.select().from(domains).orderBy(asc(domains.createdAt));
        return c.json({ domains: rows.map(toJson) }, 200);
      },
    }),
    apiRoute({
      scope: "domains:write",
      route: createRoute({
        method: "patch",
        path: "/domains/{id}",
        operationId: "updateDomain",
        summary: "Update a custom domain",
        description: "Sets or clears the domain's fallback URL.",
        request: {
          params: domainParams,
          body: jsonBody(z.strictObject({ fallbackUrl })),
        },
        responses: { 200: jsonResponse("The updated domain", Domain) },
      }),
      handler: async (c) => {
        const [domain] = await db
          .update(domains)
          .set(c.req.valid("json"))
          .where(eq(domains.id, c.req.valid("param").id))
          .returning();
        if (!domain) throw domainNotFound();
        return c.json(toJson(domain), 200);
      },
    }),
    apiRoute({
      scope: "domains:write",
      route: createRoute({
        method: "delete",
        path: "/domains/{id}",
        operationId: "deleteDomain",
        summary: "Delete a custom domain",
        description:
          "Deletes a custom domain that has no links, such as one added by mistake. Refused while any link is on it, active or deactivated.",
        request: { params: domainParams },
        responses: { 204: { description: "The domain is deleted" } },
      }),
      handler: async (c) => {
        const domain = await findDomain(c.req.valid("param").id);
        const [link] = await db.select({ id: links.id }).from(links).where(eq(links.domainId, domain.id)).limit(1);
        if (link) {
          throw apiError(
            409,
            "DOMAIN_HAS_LINKS",
            `${domain.hostname} can't be deleted because links are on it, including deactivated ones. An admin can delete deactivated links in the web app first.`,
          );
        }
        await db.delete(domains).where(eq(domains.id, domain.id));
        return c.body(null, 204);
      },
    }),
  ];
}

function domainNotFound() {
  return apiError(404, "NOT_FOUND", "This domain does not exist.");
}
