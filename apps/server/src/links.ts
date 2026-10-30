import { randomInt } from "node:crypto";
import { type Db, desc, devices, domains, eq, ilike, links, or } from "@flitzlink/db";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, apiRoute, jsonBody, jsonResponse, limitParam } from "./api.ts";

const slugAlphabet = "23456789abcdefghjkmnpqrstuvwxyz";
export const reservedSlugs = new Set(["api", "app", "docs", "qr", "health", "healthz", "assets", "static", "oauth"]);
export const slugPattern = /^[a-zA-Z0-9-]{1,64}$/;

const offsetParam = z.coerce
  .number({ error: "Use an offset of 0 or more, such as nextOffset from the previous page." })
  .int()
  .min(0)
  .default(0)
  .meta({ description: "How many links to skip. Pass `nextOffset` from the previous page." });

export const httpUrl = z
  .url({ protocol: z.regexes.httpProtocol, error: "Enter an absolute http or https URL, like https://example.com/page." })
  .max(2048, "Keep the URL under 2048 characters.");

export const countryCode = z
  .string()
  .regex(/^[a-zA-Z]{2}$/, "Use two-letter ISO country codes, like DE.")
  .toUpperCase();

const Condition = z
  .discriminatedUnion("type", [
    z.strictObject({
      type: z.literal("device"),
      device: z.enum(devices).meta({
        description:
          "`ios` matches iPhones and iPads, `android` Android phones and tablets, `mobile` all phones and tablets (iOS and Android included) and `desktop` everything else. Detection uses the user agent and client hints. Stats count devices differently: there `mobile` means phones only.",
      }),
    }),
    z.strictObject({
      type: z.literal("country"),
      countries: z.array(countryCode).min(1, "Add at least one country.").max(250, "List at most 250 countries.").meta({
        description: "Matches visitors from any of these countries, as two-letter ISO codes. Visitors of unknown country never match.",
      }),
    }),
  ])
  .openapi("Condition");
export type Condition = z.infer<typeof Condition>;

export const RedirectRule = z
  .strictObject({
    conditions: z
      .array(Condition)
      .min(1, "Add at least one condition to each redirect rule.")
      .max(10, "Use at most 10 conditions per redirect rule.")
      .meta({ description: "All conditions must match." }),
    target: httpUrl,
  })
  .openapi("RedirectRule");
export type RedirectRule = z.infer<typeof RedirectRule>;

const redirectRules = z.array(RedirectRule).max(50, "A link can have at most 50 redirect rules.").meta({
  description:
    "Checked in order: the first rule whose conditions all match sends the visitor to its target, otherwise the default target is used. When updating a link, this list replaces all of its rules, so send every rule to keep, in the new order.",
});

const Link = z
  .object({
    id: z.string(),
    slug: z.string(),
    domain: z.string().nullable().openapi({ description: "The hostname of the link's custom domain, or null on the instance domain." }),
    shortUrl: z.string(),
    defaultTarget: z.string(),
    redirectRules,
    title: z.string().nullable(),
    description: z.string().nullable(),
    active: z.boolean().openapi({ description: "False for a deactivated link, which no longer redirects." }),
    createdAt: z.string(),
  })
  .openapi("Link");
export type Link = z.infer<typeof Link>;

const linkFields = {
  defaultTarget: httpUrl.meta({
    description: "Where the link sends visitors when no redirect rule matches.",
    example: "https://example.com/page",
  }),
  redirectRules: redirectRules.optional(),
  title: z
    .string()
    .max(200, "Keep the title under 200 characters.")
    .nullable()
    .optional()
    .meta({ description: "A name to recognise the link by, at most 200 characters." }),
  description: z
    .string()
    .max(2000, "Keep the description under 2000 characters.")
    .nullable()
    .optional()
    .meta({ description: "Notes about the link, at most 2000 characters." }),
};

export const linkParams = z.object({
  id: z
    .uuid({ error: "Use the link's id from createLink or listLinks, not its slug." })
    .meta({ description: "The link's `id`, as `createLink` and `listLinks` return it. Not its slug." }),
});

export function linkRoutes(db: Db, baseUrl: string) {
  const toJson = ({ link, hostname }: { link: typeof links.$inferSelect; hostname: string | null }) => ({
    id: link.id,
    slug: link.slug,
    domain: hostname,
    shortUrl: shortUrl(baseUrl, hostname, link.slug),
    defaultTarget: link.defaultTarget,
    redirectRules: link.redirectRules,
    title: link.title,
    description: link.description,
    active: link.active,
    createdAt: link.createdAt.toISOString(),
  });

  const selectLinks = () =>
    db.select({ link: links, hostname: domains.hostname }).from(links).leftJoin(domains, eq(links.domainId, domains.id));

  async function findLink(id: string) {
    const [row] = await selectLinks().where(eq(links.id, id));
    if (!row) throw linkNotFound();
    return toJson(row);
  }

  async function findDomain(hostname: string) {
    const [domain] = await db.select().from(domains).where(eq(domains.hostname, hostname.toLowerCase()));
    if (!domain) throw apiError(400, "DOMAIN_NOT_FOUND", `${hostname} is not a custom domain of this instance. Add it first.`);
    return domain;
  }

  async function updateLink(id: string, values: Partial<typeof links.$inferInsert>) {
    const [link] = await db
      .update(links)
      .set(values)
      .where(eq(links.id, id))
      .returning({ id: links.id, domainId: links.domainId, slug: links.slug });
    if (!link) throw linkNotFound();
    return findLink(id);
  }

  return [
    apiRoute({
      scope: "links:write",
      route: createRoute({
        method: "post",
        path: "/links",
        operationId: "createLink",
        summary: "Create a link",
        description:
          "Creates a link and returns its short URL, with a generated slug unless you pass `slug`. To send visitors to different targets by device or country, pass `redirectRules`, or generate them first with a preset.",
        request: {
          body: jsonBody(
            z.strictObject({
              ...linkFields,
              domain: z.string().optional().meta({
                description: "The hostname of one of the custom domains, like go.example.com. Leave out for the instance domain.",
              }),
              slug: z.string().regex(slugPattern, "Use only letters, digits and hyphens, at most 64 characters.").optional().meta({
                description:
                  "A custom slug of letters, digits and hyphens, at most 64, stored lowercase. Leave out to get a generated one.",
              }),
            }),
          ),
        },
        responses: { 201: jsonResponse("The new link", Link) },
      }),
      handler: async (c) => {
        const { slug: customSlug, domain: hostname, ...fields } = c.req.valid("json");
        const domain = hostname === undefined ? undefined : await findDomain(hostname);
        const slug = customSlug?.toLowerCase();
        if (slug && reservedSlugs.has(slug)) throw apiError(400, "SLUG_RESERVED", `The slug "${slug}" is reserved. Choose another one.`);
        for (let attempt = 1; ; attempt++) {
          const [link] = await db
            .insert(links)
            .values({ ...fields, domainId: domain?.id, slug: slug ?? generateSlug() })
            .onConflictDoNothing()
            .returning();
          if (link) {
            return c.json(toJson({ link, hostname: domain?.hostname ?? null }), 201);
          }
          if (slug !== undefined) throw slugTaken(slug);
          if (attempt === 3) throw new Error("No free slug after 3 attempts");
        }
      },
    }),
    apiRoute({
      scope: "links:read",
      route: createRoute({
        method: "get",
        path: "/links",
        operationId: "listLinks",
        summary: "List links",
        description:
          "Lists the links, newest first, a page at a time. `search` finds links whose title, slug or default target contains the text, ignoring case. To find a link by its short URL, search for its slug (the path after the domain) and pick the link whose `shortUrl` matches: a search also finds longer slugs, and the same slug can exist on several domains.",
        request: {
          query: z.object({
            search: z
              .string()
              .optional()
              .meta({ description: "Text to look for in the title, slug and default target, ignoring case. Parts match too." }),
            limit: limitParam.meta({ description: "The most links to return, from 1 to 100." }),
            offset: offsetParam,
          }),
        },
        responses: {
          200: jsonResponse(
            "A page of links",
            z.object({
              links: z.array(Link),
              nextOffset: z.number().nullable().openapi({ description: "The offset of the next page, or null on the last page." }),
            }),
          ),
        },
      }),
      handler: async (c) => {
        const { search, limit, offset } = c.req.valid("query");
        const pattern = search && `%${search.replace(/[\\%_]/g, "\\$&")}%`;
        const rows = await selectLinks()
          .where(pattern ? or(ilike(links.title, pattern), ilike(links.slug, pattern), ilike(links.defaultTarget, pattern)) : undefined)
          .orderBy(desc(links.createdAt), desc(links.id))
          .limit(limit + 1)
          .offset(offset);
        return c.json({ links: rows.slice(0, limit).map(toJson), nextOffset: rows.length > limit ? offset + limit : null }, 200);
      },
    }),
    apiRoute({
      scope: "links:read",
      route: createRoute({
        method: "get",
        path: "/links/{id}",
        operationId: "getLink",
        summary: "Get a link",
        description: "Returns one link by its `id`. To find a link by its slug or short URL, call `listLinks` with the slug as `search`.",
        request: { params: linkParams },
        responses: { 200: jsonResponse("The link", Link) },
      }),
      handler: async (c) => c.json(await findLink(c.req.valid("param").id), 200),
    }),
    apiRoute({
      scope: "links:write",
      route: createRoute({
        method: "patch",
        path: "/links/{id}",
        operationId: "updateLink",
        summary: "Update a link",
        description:
          "Changes a link's default target, redirect rules, title or description and keeps the fields you leave out. `redirectRules` replaces all of the link's rules: send the whole list in the new order, including the rules to keep. The slug and domain never change.",
        request: {
          params: linkParams,
          body: jsonBody(
            z
              .strictObject(linkFields)
              .partial()
              .refine(
                (fields) => Object.keys(fields).length > 0,
                "Send at least one of defaultTarget, redirectRules, title or description.",
              ),
          ),
        },
        responses: { 200: jsonResponse("The updated link", Link) },
      }),
      handler: async (c) => c.json(await updateLink(c.req.valid("param").id, c.req.valid("json")), 200),
    }),
    apiRoute({
      scope: "links:write",
      route: createRoute({
        method: "post",
        path: "/links/{id}/deactivate",
        operationId: "deactivateLink",
        summary: "Deactivate a link",
        description: "Stops a link from redirecting. It keeps its slug and click history and can be reactivated.",
        request: { params: linkParams },
        responses: { 200: jsonResponse("The deactivated link", Link) },
      }),
      handler: async (c) => c.json(await updateLink(c.req.valid("param").id, { active: false }), 200),
    }),
    apiRoute({
      scope: "links:write",
      route: createRoute({
        method: "post",
        path: "/links/{id}/reactivate",
        operationId: "reactivateLink",
        summary: "Reactivate a link",
        description: "Makes a deactivated link redirect again.",
        request: { params: linkParams },
        responses: { 200: jsonResponse("The reactivated link", Link) },
      }),
      handler: async (c) => c.json(await updateLink(c.req.valid("param").id, { active: true }), 200),
    }),
  ];
}

function generateSlug() {
  return Array.from({ length: 7 }, () => slugAlphabet[randomInt(slugAlphabet.length)]).join("");
}

export function shortUrl(baseUrl: string, hostname: string | null, slug: string) {
  return hostname ? `https://${hostname}/${slug}` : new URL(slug, baseUrl).href;
}

function slugTaken(slug: string) {
  return apiError(409, "SLUG_TAKEN", `The slug "${slug}" is already taken. Choose another one.`);
}

export function linkNotFound() {
  return apiError(404, "NOT_FOUND", "This link does not exist.");
}
