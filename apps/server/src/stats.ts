import { and, asc, clicks, type Db, desc, domains, eq, isNotNull, isNull, links, or, sql } from "@flitzlink/db";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, apiRoute, jsonResponse, limitParam } from "./api.ts";
import { linkNotFound, shortUrl } from "./links.ts";
import { readSettings } from "./settings.ts";

const maxDays = 400;
const maxHourlyDays = 31;
const dayMs = 24 * 60 * 60 * 1000;
const exportPageSize = 1000;

const dimensions = {
  country: clicks.country,
  device: clicks.deviceType,
  os: clicks.os,
  browser: clicks.browser,
  referrer: clicks.referrerDomain,
  utmSource: sql`${clicks.query}->>'utm_source'`,
  utmMedium: sql`${clicks.query}->>'utm_medium'`,
  utmCampaign: sql`${clicks.query}->>'utm_campaign'`,
  utmContent: sql`${clicks.query}->>'utm_content'`,
  utmTerm: sql`${clicks.query}->>'utm_term'`,
};
type Dimension = keyof typeof dimensions;
const dimensionNames = Object.keys(dimensions) as [Dimension, ...Dimension[]];
const breakdownName = z.enum([...dimensionNames, "link"]);

const botFilters = { exclude: eq(clicks.bot, false), only: eq(clicks.bot, true), include: undefined };
const labelFormats = { day: "YYYY-MM-DD", hour: 'YYYY-MM-DD"T"HH24:MI' };

const day = (description: string) => z.iso.date({ error: "Use a day as YYYY-MM-DD, like 2026-03-31." }).optional().meta({ description });

const rangeFields = {
  from: day(
    `The first day, as YYYY-MM-DD in the instance's time zone. Defaults to 29 days before \`to\`. A range spans at most ${maxDays} days.`,
  ),
  to: day("The last day, included, as YYYY-MM-DD in the instance's time zone. Defaults to today."),
  bots: z.enum(["exclude", "include", "only"]).default("exclude").meta({
    description:
      "`exclude` leaves out bot clicks (crawlers, link previews, email scanners), `only` counts just bot clicks, `include` counts all clicks.",
  }),
};

const dimensionNotes: Partial<Record<Dimension, string>> = {
  device: " Here `mobile` means phones only, unlike in redirect rule conditions.",
};

const clickFields = {
  linkId: z
    .uuid({ error: "Use the link's id from createLink or listLinks, not its slug." })
    .optional()
    .meta({ description: "Only this link's clicks, by its `id`. Leave out for all links." }),
  ...rangeFields,
  ...(Object.fromEntries(
    dimensionNames.map((name) => [
      name,
      z
        .string()
        .max(500, `Keep ${name} under 500 characters.`)
        .optional()
        .meta({
          description: `Only clicks whose ${name} is this value, as \`getClickBreakdown\` returns it. An empty value matches clicks without one.${dimensionNotes[name] ?? ""}`,
        }),
    ]),
  ) as Record<Dimension, z.ZodOptional<z.ZodString>>),
};

const rangeResponse = {
  timeZone: z.string().openapi({ description: "The instance's IANA time zone, in which days and hours start." }),
  from: z.string().openapi({ description: "The first day of the range, as YYYY-MM-DD." }),
  to: z.string().openapi({ description: "The last day of the range, included, as YYYY-MM-DD." }),
};

const clickTimeSeries = z
  .object({
    ...rangeResponse,
    interval: z.enum(["day", "hour"]),
    clicks: z.number().openapi({ description: "All clicks in the range." }),
    series: z.array(
      z.object({
        start: z.string().openapi({
          description: "When the day or hour starts in the instance's time zone, as YYYY-MM-DD for days and YYYY-MM-DDTHH:MM for hours.",
        }),
        clicks: z.number(),
        uniqueVisitors: z.number(),
      }),
    ),
  })
  .openapi("ClickTimeSeries");

const dimensionValues = z.array(z.object({ value: z.string().nullable(), clicks: z.number() }));
const clickBreakdown = z
  .object({
    ...rangeResponse,
    breakdowns: z
      .object({
        ...(Object.fromEntries(dimensionNames.map((name) => [name, dimensionValues.optional()])) as Record<
          Dimension,
          z.ZodOptional<typeof dimensionValues>
        >),
        link: z
          .array(
            z.object({
              value: z.string().openapi({ description: "The link's `id`." }),
              clicks: z.number(),
              shortUrl: z.string(),
              title: z.string().nullable(),
            }),
          )
          .optional(),
      })
      .openapi({ description: "One list per requested `by`, each with the clicks per value, most clicks first." }),
  })
  .openapi("ClickBreakdown");

const orphanClicks = z
  .object({
    ...rangeResponse,
    domain: z.string().nullable().openapi({ description: "The domain you asked for, or null for all domains." }),
    slugs: z.array(z.object({ slug: z.string(), shortUrl: z.string(), clicks: z.number(), lastClickedAt: z.string() })),
  })
  .openapi("OrphanClicks");

export type ClickTimeSeries = z.infer<typeof clickTimeSeries>;
export type ClickBreakdown = z.infer<typeof clickBreakdown>;
export type OrphanClicks = z.infer<typeof orphanClicks>;

type Range = { timeZone: string; from: string; to: string };
type ClickQuery = { linkId?: string; from?: string; to?: string; bots: keyof typeof botFilters } & Partial<Record<Dimension, string>>;

function inRange({ timeZone, from, to }: Range) {
  return sql`${clicks.clickedAt} >= ${from}::timestamp at time zone ${timeZone} and ${clicks.clickedAt} < (${to}::date + 1)::timestamp at time zone ${timeZone}`;
}

const formulaStart = /(^|[,;|\t\r\n])(?=[=+\-@\t\r])/g;

function csvLine(values: (string | null | undefined)[]) {
  const cells = values.map((value) => {
    const text = (value ?? "").replace(formulaStart, "$1'");
    return /[",;|\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  });
  return `${cells.join(",")}\r\n`;
}

export function statsRoutes(db: Db, baseUrl: string) {
  async function statsRange(query: { from?: string; to?: string }, maxRange = maxDays): Promise<Range> {
    const { timeZone } = await readSettings(db);
    const to = query.to ?? new Date().toLocaleDateString("en-CA", { timeZone });
    const from = query.from ?? new Date(Date.parse(to) - 29 * dayMs).toISOString().slice(0, 10);
    const days = (Date.parse(to) - Date.parse(from)) / dayMs + 1;
    if (days < 1) throw apiError(400, "INVALID_REQUEST", "Choose a `from` day on or before the `to` day.");
    if (days > maxRange) {
      throw apiError(400, "INVALID_REQUEST", `Choose \`from\` and \`to\` at most ${maxRange} days apart, both days included.`);
    }
    return { timeZone, from, to };
  }

  async function linkClicks(query: ClickQuery, maxRange = maxDays) {
    const [[link], range] = await Promise.all([
      query.linkId ? db.select({ id: links.id }).from(links).where(eq(links.id, query.linkId)) : [],
      statsRange(query, maxRange),
    ]);
    if (query.linkId && !link) throw linkNotFound();
    const where = and(
      query.linkId ? eq(clicks.linkId, query.linkId) : isNotNull(clicks.linkId),
      inRange(range),
      botFilters[query.bots],
      ...dimensionNames.map((name) => {
        const value = query[name];
        if (value === undefined) return undefined;
        return value === "" ? sql`${dimensions[name]} is null` : sql`${dimensions[name]} = ${value}`;
      }),
    );
    return { range, where };
  }

  async function* csvRows(where: ReturnType<typeof and>) {
    yield csvLine([
      "clickedAt",
      "shortUrl",
      "linkId",
      "bot",
      "device",
      "os",
      "browser",
      "country",
      "region",
      "referrer",
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmContent",
      "utmTerm",
      "query",
    ]);
    for (let after: typeof clicks.$inferSelect | undefined; ;) {
      const page = await db
        .select({ click: clicks, hostname: domains.hostname })
        .from(clicks)
        .leftJoin(domains, eq(clicks.domainId, domains.id))
        .where(and(where, after && sql`(${clicks.clickedAt}, ${clicks.id}) > (${after.clickedAt.toISOString()}::timestamptz, ${after.id})`))
        .orderBy(asc(clicks.clickedAt), asc(clicks.id))
        .limit(exportPageSize);
      yield page
        .map(({ click, hostname }) =>
          csvLine([
            click.clickedAt.toISOString(),
            shortUrl(baseUrl, hostname, click.slug),
            click.linkId,
            String(click.bot),
            click.deviceType,
            click.os,
            click.browser,
            click.country,
            click.region,
            click.referrerDomain,
            click.query.utm_source,
            click.query.utm_medium,
            click.query.utm_campaign,
            click.query.utm_content,
            click.query.utm_term,
            new URLSearchParams(click.query).toString(),
          ]),
        )
        .join("");
      if (page.length < exportPageSize) return;
      after = page[page.length - 1].click;
    }
  }

  return [
    apiRoute({
      scope: "stats:read",
      route: createRoute({
        method: "get",
        path: "/stats/time-series",
        operationId: "getClickTimeSeries",
        summary: "Get clicks and unique visitors over time",
        description:
          "Counts clicks and unique visitors per day or hour in the instance's time zone, for one link or all links, with every day or hour of the range listed. Bot clicks are left out unless `bots` says otherwise. Unique visitors are distinct visitor hashes per day or hour. The visitor hash changes every day at midnight UTC, so flitz can't count unique visitors across days: adding up daily unique visitors counts a returning visitor once per day, and in a time zone other than UTC a visitor who clicks on both sides of midnight UTC counts twice on that day.",
        request: {
          query: z.object({
            ...clickFields,
            interval: z
              .enum(["day", "hour"])
              .default("day")
              .meta({
                description: `\`day\` or \`hour\` buckets. With \`hour\`, a range spans at most ${maxHourlyDays} days.`,
              }),
          }),
        },
        responses: { 200: jsonResponse("The clicks per day or hour", clickTimeSeries) },
      }),
      handler: async (c) => {
        const { interval, ...query } = c.req.valid("query");
        const { range, where } = await linkClicks(query, interval === "hour" ? maxHourlyDays : maxDays);
        const step = `1 ${interval}`;
        const series = await db.execute<{ start: string; clicks: number; uniqueVisitors: number }>(sql`
          with counts as (
            select date_trunc(${interval}, ${clicks.clickedAt} at time zone ${range.timeZone}) as start,
              count(*)::int as clicks,
              count(distinct ${clicks.visitorHash})::int as unique_visitors
            from ${clicks} where ${where} group by 1
          )
          select to_char(series.start, ${labelFormats[interval]}) as start,
            coalesce(counts.clicks, 0) as clicks,
            coalesce(counts.unique_visitors, 0) as "uniqueVisitors"
          from generate_series(${range.from}::timestamp, (${range.to}::date + 1)::timestamp - ${step}::interval, ${step}::interval) as series(start)
          left join counts on counts.start = series.start
          order by series.start`);
        const total = series.reduce((sum, bucket) => sum + bucket.clicks, 0);
        return c.json({ ...range, interval, clicks: total, series: [...series] }, 200);
      },
    }),
    apiRoute({
      scope: "stats:read",
      route: createRoute({
        method: "get",
        path: "/stats/breakdown",
        operationId: "getClickBreakdown",
        summary: "Break down clicks by country, device, referrer or campaign",
        description:
          "Counts clicks per value of one or more properties, most clicks first, for one link or all links, with one list per requested `by` in `breakdowns`. Bot clicks are left out unless `bots` says otherwise. `value` is null for clicks without one, such as clicks without a referrer. With `by` set to `link`, `value` is the link's `id`, and each value also has the link's `shortUrl` and `title`.",
        request: {
          query: z.object({
            ...clickFields,
            by: z.union([breakdownName, z.array(breakdownName).min(1)]).meta({
              description:
                "One property, or a list of them for several breakdowns in one call (in a query string, repeat it: `by=country&by=device`). `country` is a two-letter code like DE; `device` is the device type: `desktop`, `mobile` for phones, `tablet`, or another type such as `smarttv` (unlike in redirect rule conditions, `mobile` excludes tablets, and iOS and Android are values of `os`); `os` and `browser` are names like iOS or Chrome; `referrer` is the domain of the page the click came from; `utmSource`, `utmMedium`, `utmCampaign`, `utmContent` and `utmTerm` are the `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` and `utm_term` query parameters of the short URL; `link` is the link, to find the top links.",
            }),
            limit: limitParam.meta({ description: "The most values to return per breakdown, at most 100." }),
          }),
        },
        responses: { 200: jsonResponse("The clicks per value of each requested property", clickBreakdown) },
      }),
      handler: async (c) => {
        const { by, limit, ...query } = c.req.valid("query");
        const { range, where } = await linkClicks(query);
        const breakdown = async (name: z.infer<typeof breakdownName>) => {
          if (name === "link") {
            const rows = await db
              .select({
                value: links.id,
                clicks: sql<number>`count(*)::int`,
                slug: links.slug,
                hostname: domains.hostname,
                title: links.title,
              })
              .from(clicks)
              .innerJoin(links, eq(links.id, clicks.linkId))
              .leftJoin(domains, eq(domains.id, links.domainId))
              .where(where)
              .groupBy(links.id, domains.hostname)
              .orderBy(desc(sql`count(*)`), asc(links.id))
              .limit(limit);
            return rows.map(({ slug, hostname, ...row }) => ({ ...row, shortUrl: shortUrl(baseUrl, hostname, slug) }));
          }
          return db
            .select({ value: sql<string | null>`${dimensions[name]}`, clicks: sql<number>`count(*)::int` })
            .from(clicks)
            .where(where)
            .groupBy(dimensions[name])
            .orderBy(desc(sql`count(*)`), asc(dimensions[name]))
            .limit(limit);
        };
        const names = [...new Set([by].flat())];
        const breakdowns = Object.fromEntries(await Promise.all(names.map(async (name) => [name, await breakdown(name)])));
        return c.json({ ...range, breakdowns: breakdowns as ClickBreakdown["breakdowns"] }, 200);
      },
    }),
    apiRoute({
      scope: "stats:read",
      route: createRoute({
        method: "get",
        path: "/stats/orphan-clicks",
        operationId: "getOrphanClicks",
        summary: "List orphan clicks",
        description:
          "Lists the slugs that got orphan clicks (requests whose slug matches no active link) on all domains, or on one custom domain, most clicks first, to find mistyped or outdated printed short URLs.",
        request: {
          query: z.object({
            domain: z.string().optional().meta({
              description:
                "The hostname of one of the custom domains, to list only its orphan clicks. Leave out for all domains, including the instance domain.",
            }),
            ...rangeFields,
            limit: limitParam,
          }),
        },
        responses: { 200: jsonResponse("The slugs with orphan clicks", orphanClicks) },
      }),
      handler: async (c) => {
        const { domain: hostname, limit, ...query } = c.req.valid("query");
        const [[domain], range] = await Promise.all([
          hostname
            ? db.select({ id: domains.id, hostname: domains.hostname }).from(domains).where(eq(domains.hostname, hostname.toLowerCase()))
            : [],
          statsRange(query),
        ]);
        if (hostname && !domain) {
          throw apiError(400, "DOMAIN_NOT_FOUND", `${hostname} is not a custom domain of this instance. Leave out domain for all of them.`);
        }
        const rows = await db
          .select({
            slug: clicks.slug,
            hostname: domains.hostname,
            clicks: sql<number>`count(*)::int`,
            lastClickedAt: sql`max(${clicks.clickedAt})`.mapWith(clicks.clickedAt),
          })
          .from(clicks)
          .leftJoin(domains, eq(domains.id, clicks.domainId))
          .where(
            and(
              isNull(clicks.linkId),
              or(isNull(clicks.domainId), isNotNull(domains.id)),
              inRange(range),
              botFilters[query.bots],
              domain && eq(clicks.domainId, domain.id),
            ),
          )
          .groupBy(clicks.slug, domains.hostname)
          .orderBy(desc(sql`count(*)`), asc(clicks.slug), asc(domains.hostname))
          .limit(limit);
        const slugs = rows.map(({ hostname, ...row }) => ({
          ...row,
          shortUrl: shortUrl(baseUrl, hostname, row.slug),
          lastClickedAt: row.lastClickedAt.toISOString(),
        }));
        return c.json({ ...range, domain: domain?.hostname ?? null, slugs }, 200);
      },
    }),
    apiRoute({
      scope: "stats:read",
      route: createRoute({
        method: "get",
        path: "/stats/export",
        operationId: "exportClicks",
        summary: "Export clicks as CSV",
        description:
          "Streams the raw clicks of one link or all links as CSV, oldest first, with the same filters as `getClickTimeSeries`. `clickedAt` is in UTC. Bot clicks are left out unless `bots` says otherwise. The export has no visitor hash. For questions about totals, prefer `getClickTimeSeries` and `getClickBreakdown`, which return far less text.",
        request: { query: z.object(clickFields) },
        responses: {
          200: {
            description: "The clicks as CSV with a header row",
            content: { "text/csv": { schema: z.string() } },
          },
        },
      }),
      handler: async (c) => {
        const { range, where } = await linkClicks(c.req.valid("query"));
        const rows = csvRows(where);
        const csv = new ReadableStream<string>({
          async pull(controller) {
            const { done, value } = await rows.next();
            if (done) controller.close();
            else controller.enqueue(value);
          },
        });
        return new Response(csv.pipeThrough(new TextEncoderStream()), {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="clicks-${range.from}-to-${range.to}.csv"`,
          },
        });
      },
    }),
  ];
}
