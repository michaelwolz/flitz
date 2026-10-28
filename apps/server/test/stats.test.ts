import { clicks, connectAndMigrate, domains, links } from "@flitzlink/db";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { createPartitions } from "../src/clicks.ts";
import { testEnv, verifiedUser } from "./client.ts";

const env = await testEnv();
const { app, close } = await createApp(env);
const db = await connectAndMigrate(env.DATABASE_URL);
afterAll(() => Promise.all([close(), db.$client.end()]));

const owner = { cookie: (await verifiedUser(app, "owner-stats@example.com")).cookie };

const now = new Date();
const month = { year: now.getUTCFullYear(), index: now.getUTCMonth() - 1 };
const at = (day: number, hour: number, minute = 0) => new Date(Date.UTC(month.year, month.index, day, hour, minute));
const date = (day: number) => at(day, 0).toISOString().slice(0, 10);
await createPartitions(db, [at(1, 0)]);

let seeded = 0;
async function seed(defaults: Partial<typeof clicks.$inferInsert>, ...rows: Partial<typeof clicks.$inferInsert>[]) {
  await db.insert(clicks).values(
    rows.map((row) => ({
      id: `stats-${seeded++}`,
      clickedAt: at(10, 12),
      slug: "seeded",
      deviceType: "mobile",
      query: {},
      bot: false,
      visitorHash: "visitor",
      ...defaults,
      ...row,
    })),
  );
}

async function createLink(slug: string, values: Partial<typeof links.$inferInsert> = {}) {
  const [link] = await db
    .insert(links)
    .values({ slug, defaultTarget: "https://example.com/", ...values })
    .returning();
  return link;
}

async function get(path: string) {
  const response = await app.request(path, { headers: owner });
  return { status: response.status, body: await response.json() };
}

test("the time series counts Clicks and unique visitors per day of the instance's time zone", async () => {
  const invalid = await app.request("/api/settings", {
    method: "PATCH",
    headers: { ...owner, "content-type": "application/json" },
    body: JSON.stringify({ timeZone: "Mars/Base" }),
  });
  expect(invalid.status).toBe(400);
  expect((await invalid.json()).message).toContain("Europe/Berlin");
  const settings = await app.request("/api/settings", {
    method: "PATCH",
    headers: { ...owner, "content-type": "application/json" },
    body: JSON.stringify({ timeZone: "Europe/Berlin" }),
  });
  expect(await settings.json()).toMatchObject({ timeZone: "Europe/Berlin" });

  const link = await createLink("stats-series");
  await seed(
    { linkId: link.id, slug: link.slug },
    { clickedAt: at(9, 12), visitorHash: "ada" },
    { clickedAt: at(9, 23, 30), visitorHash: "ada" },
    { clickedAt: at(10, 8), visitorHash: "bob" },
    { clickedAt: at(10, 9), visitorHash: "bot", bot: true },
  );

  const { body } = await get(`/api/stats/time-series?linkId=${link.id}&from=${date(9)}&to=${date(11)}`);
  expect(body).toEqual({
    timeZone: "Europe/Berlin",
    from: date(9),
    to: date(11),
    interval: "day",
    clicks: 3,
    series: [
      { start: date(9), clicks: 1, uniqueVisitors: 1 },
      { start: date(10), clicks: 2, uniqueVisitors: 2 },
      { start: date(11), clicks: 0, uniqueVisitors: 0 },
    ],
  });
  expect((await get(`/api/stats/time-series?linkId=${link.id}&from=2020-01-01&to=2025-01-01`)).status).toBe(400);
});

test("the UTM breakdowns come in one call and leave out Bot Clicks unless asked for", async () => {
  const link = await createLink("stats-utm");
  const newsletter = (campaign: string) => ({
    query: { utm_source: "newsletter", utm_campaign: campaign, utm_content: "header_button", utm_term: "link shortener" },
  });
  await seed(
    { linkId: link.id, slug: link.slug },
    newsletter("spring"),
    newsletter("spring"),
    newsletter("summer"),
    { query: { utm_source: "flyer", utm_campaign: "spring" } },
    { ...newsletter("summer"), bot: true },
  );

  const breakdown = async (bots: string) =>
    (await get(`/api/stats/breakdown?linkId=${link.id}&by=utmCampaign&utmSource=newsletter&bots=${bots}&from=${date(10)}&to=${date(10)}`))
      .body.breakdowns.utmCampaign;
  expect(await breakdown("exclude")).toEqual([
    { value: "spring", clicks: 2 },
    { value: "summer", clicks: 1 },
  ]);
  expect(await breakdown("include")).toEqual([
    { value: "spring", clicks: 2 },
    { value: "summer", clicks: 2 },
  ]);
  expect(await breakdown("only")).toEqual([{ value: "summer", clicks: 1 }]);
  expect(
    (await get(`/api/stats/breakdown?linkId=${link.id}&by=utmSource&by=utmMedium&by=utmContent&by=utmTerm&from=${date(10)}&to=${date(10)}`))
      .body.breakdowns,
  ).toEqual({
    utmSource: [
      { value: "newsletter", clicks: 3 },
      { value: "flyer", clicks: 1 },
    ],
    utmMedium: [{ value: null, clicks: 4 }],
    utmContent: [
      { value: "header_button", clicks: 3 },
      { value: null, clicks: 1 },
    ],
    utmTerm: [
      { value: "link shortener", clicks: 3 },
      { value: null, clicks: 1 },
    ],
  });
  const range = `linkId=${link.id}&from=${date(10)}&to=${date(10)}`;
  expect((await get(`/api/stats/time-series?${range}&utmContent=header_button&utmTerm=link+shortener`)).body.clicks).toBe(3);
  expect((await get(`/api/stats/time-series?${range}&utmContent=&utmTerm=`)).body.clicks).toBe(1);
  expect((await get(`/api/stats/breakdown?${range}&by=utmContent&utmTerm=missing`)).body.breakdowns.utmContent).toEqual([]);
});

test("the link breakdown lists the top Links with their Short URL and title, without Orphan Clicks", async () => {
  const [domain] = await db.insert(domains).values({ hostname: "go.top.example" }).returning();
  const flyer = await createLink("stats-flyer", { domainId: domain.id, title: "Flyer" });
  const poster = await createLink("stats-poster");
  await seed(
    { clickedAt: at(12, 12) },
    { linkId: flyer.id, slug: flyer.slug, domainId: domain.id },
    { linkId: flyer.id, slug: flyer.slug, domainId: domain.id },
    { linkId: poster.id, slug: poster.slug },
    { linkId: null, slug: "stats-missing" },
  );

  expect((await get(`/api/stats/breakdown?by=link&from=${date(12)}&to=${date(12)}`)).body.breakdowns.link).toEqual([
    { value: flyer.id, clicks: 2, shortUrl: "https://go.top.example/stats-flyer", title: "Flyer" },
    { value: poster.id, clicks: 1, shortUrl: "http://localhost:3000/stats-poster", title: null },
  ]);
});

test("Orphan Clicks are listed for all Domains or one", async () => {
  const [domain] = await db.insert(domains).values({ hostname: "go.stats.example" }).returning();
  const deactivated = await createLink("stats-old", { active: false, createdAt: at(1, 0) });
  await seed(
    { linkId: null },
    { domainId: domain.id, slug: "sprnig", clickedAt: at(10, 8) },
    { domainId: domain.id, slug: "sprnig", clickedAt: at(10, 9) },
    { domainId: domain.id, slug: "fall", clickedAt: at(10, 10) },
    { domainId: crypto.randomUUID(), slug: "stats-deleted-domain" },
    { slug: deactivated.slug },
    { slug: "unknown" },
  );

  const range = `from=${date(10)}&to=${date(10)}`;
  expect((await get(`/api/stats/orphan-clicks?domain=go.stats.example&${range}`)).body.slugs).toEqual([
    { slug: "sprnig", shortUrl: "https://go.stats.example/sprnig", clicks: 2, lastClickedAt: at(10, 9).toISOString() },
    { slug: "fall", shortUrl: "https://go.stats.example/fall", clicks: 1, lastClickedAt: at(10, 10).toISOString() },
  ]);
  expect((await get(`/api/stats/orphan-clicks?${range}`)).body.slugs).toEqual([
    { slug: "sprnig", shortUrl: "https://go.stats.example/sprnig", clicks: 2, lastClickedAt: at(10, 9).toISOString() },
    { slug: "fall", shortUrl: "https://go.stats.example/fall", clicks: 1, lastClickedAt: at(10, 10).toISOString() },
    { slug: "stats-old", shortUrl: "http://localhost:3000/stats-old", clicks: 1, lastClickedAt: at(10, 12).toISOString() },
    { slug: "unknown", shortUrl: "http://localhost:3000/unknown", clicks: 1, lastClickedAt: at(10, 12).toISOString() },
  ]);
});

test("the CSV export streams raw Clicks with a header row", async () => {
  const link = await createLink("stats-export");
  await seed(
    { linkId: link.id, slug: link.slug },
    {
      os: "iOS",
      country: "DE",
      referrerDomain: "news.example.org",
      query: { utm_source: "newsletter", utm_campaign: "=1+1;@A1|-2", utm_content: "header,button", utm_term: "=keyword" },
    },
  );

  const response = await app.request(`/api/stats/export?linkId=${link.id}&from=${date(10)}&to=${date(10)}`, { headers: owner });
  expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
  expect((await response.text()).split("\r\n")).toEqual([
    "clickedAt,shortUrl,linkId,bot,device,os,browser,country,region,referrer,utmSource,utmMedium,utmCampaign,utmContent,utmTerm,query",
    `${at(10, 12).toISOString()},http://localhost:3000/stats-export,${link.id},false,mobile,iOS,,DE,,news.example.org,newsletter,,"'=1+1;'@A1|'-2","header,button",'=keyword,utm_term=%3Dkeyword&utm_source=newsletter&utm_content=header%2Cbutton&utm_campaign=%3D1%2B1%3B%40A1%7C-2`,
    "",
  ]);
});
