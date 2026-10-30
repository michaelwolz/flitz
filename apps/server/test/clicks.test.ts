import { asc, clicks, connectDb, domains, eq, isNull, links, sql } from "@flitzlink/db";
import { afterAll, expect, test, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { testEnv } from "./client.ts";

const env = await testEnv();
const ip = "203.0.113.7";
const { app, close } = await createApp(env, { lookupLocation: (address) => (address === ip ? { country: "DE", region: "BY" } : {}) });
const db = await connectDb(env.DATABASE_URL);
afterAll(() => Promise.all([close(), db.$client.end()]));

const iPhone =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function createLink(slug: string, active = true) {
  const [link] = await db.insert(links).values({ slug, defaultTarget: "https://example.com/", active }).returning();
  return link;
}

async function click(url: string, headers: Record<string, string> = {}) {
  const response = await app.request(url, { headers: { "x-forwarded-for": ip, "user-agent": iPhone, ...headers } });
  expect(response.headers.get("set-cookie")).toBeNull();
  return response.status;
}

async function storedClicks(linkId: string, count: number) {
  const rows = await db.select().from(clicks).where(eq(clicks.linkId, linkId)).orderBy(asc(clicks.clickedAt), asc(clicks.id));
  expect(rows).toHaveLength(count);
  return rows;
}

test("a redirect records a Click with its facts and Visitor Hash but never the IP", async () => {
  const link = await createLink("click-fields");
  const status = await click("/Click-Fields?utm_source=flyer&lang=de", { referer: "https://news.example.org/a?id=1" });
  expect(status).toBe(302);

  const [row] = await storedClicks(link.id, 1);
  expect(row).toMatchObject({
    linkId: link.id,
    domainId: null,
    slug: "click-fields",
    deviceType: "mobile",
    os: "iOS",
    browser: "Mobile Safari",
    country: "DE",
    region: "BY",
    referrerDomain: "news.example.org",
    query: { utm_source: "flyer", lang: "de" },
    bot: false,
  });
  expect(Date.now() - row.clickedAt.getTime()).toBeLessThan(60_000);
  expect(row.visitorHash).toMatch(/^[\w-]{43}$/);
  expect(JSON.stringify(row)).not.toContain(ip);
});

test("link previews and email scanners are recorded as Bot Clicks", async () => {
  const link = await createLink("click-bots");
  for (const userAgent of [
    "Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)",
    "Mozilla/5.0 (Windows NT 6.1; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/51.0.2704.103 Safari/537.36 SkypeUriPreview Preview/0.5 skype-url-preview@microsoft.com",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36 Edg/122.0.0.0 MicrosoftPreview/2.0 +https://aka.ms/MicrosoftPreview",
    "Microsoft Office/16.0 (Windows NT 10.0; Microsoft Outlook 16.0.17928; Pro)",
    "Mozilla/4.0 (compatible; ms-office; MSOffice 16)",
  ]) {
    await click("/click-bots", { "user-agent": userAgent });
  }
  expect((await storedClicks(link.id, 5)).map((row) => row.bot)).toEqual([true, true, true, true, true]);
});

test("Visitor Hashes agree across replicas and restarts, rotate daily, and never store the IP", async () => {
  const link = await createLink("click-visitors");
  const replica = await createApp(env);
  const visit = (other: typeof app, n: string) =>
    other.request(`/click-visitors?n=${n}`, {
      headers: { "x-forwarded-for": ip, "user-agent": iPhone },
    });
  try {
    await Promise.all([visit(app, "first"), visit(replica.app, "replica")]);
  } finally {
    await replica.close();
  }
  const restarted = await createApp(env);
  try {
    await visit(restarted.app, "restart");
  } finally {
    await restarted.close();
  }
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2040-01-01T00:00:00Z") });
  try {
    await click("/click-visitors?n=skew");
  } finally {
    vi.useRealTimers();
  }
  await click("/click-visitors?n=other", { "x-forwarded-for": "198.51.100.1" });
  const [{ salt: oldSalt }] = await db.execute<{ salt: string }>(sql`select salt from visitor_salt`);
  await db.execute(sql`update visitor_salt set day = '2000-01-01'`);
  await click("/click-visitors?n=tomorrow");
  const hash = Object.fromEntries((await storedClicks(link.id, 6)).map((row) => [row.query.n, row.visitorHash]));
  expect(hash.replica).toBe(hash.first);
  expect(hash.restart).toBe(hash.first);
  expect(hash.skew).toBe(hash.first);
  const skew = (await storedClicks(link.id, 6)).find((row) => row.query.n === "skew")!;
  expect(Math.abs(Date.now() - skew.clickedAt.getTime())).toBeLessThan(60_000);
  expect(hash.other).not.toBe(hash.first);
  expect(hash.tomorrow).not.toBe(hash.first);
  const salts = await db.execute(sql`select * from visitor_salt`);
  expect(salts).toHaveLength(1);
  expect(JSON.stringify(salts)).not.toContain(oldSalt);
  expect(JSON.stringify(salts)).not.toContain(ip);
}, 20_000);

test("control characters are removed before direct Click persistence", async () => {
  const link = await createLink("click-poison");
  expect(await click("/click-poison?x=a%00b")).toBe(302);
  expect(await click("/click-poison?after=1")).toBe(302);
  expect((await storedClicks(link.id, 2)).map((row) => row.query)).toEqual(expect.arrayContaining([{ x: "ab" }, { after: "1" }]));
});

test("a Click keeps at most 20 query parameters of 256 characters each, and 2 KB of them in all", async () => {
  const link = await createLink("click-query-cap");
  const params = (value: string) => Array.from({ length: 30 }, (_, i) => `p${i}=${value}`).join("&");
  await click(`/click-query-cap?${params("1")}`);
  await click(`/click-query-cap?${params("v".repeat(300))}`);

  const kept = (count: number, value: string) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, value]));
  expect((await storedClicks(link.id, 2)).map((row) => row.query)).toEqual(
    expect.arrayContaining([kept(20, "1"), kept(7, "v".repeat(256))]),
  );
});

test("unknown and deactivated Slugs record Orphan Clicks with their Domain and Slug", async () => {
  await createLink("click-gone", false);
  const [domain] = await db.insert(domains).values({ hostname: "go.click-pipeline.example" }).returning();
  expect(await click("/click-gone")).toBe(404);
  expect(await click("/click-unknown")).toBe(404);
  expect(await click("/favicon.ico")).toBe(404);
  expect(await click("http://go.click-pipeline.example/Click-Typo")).toBe(404);
  await createLink("click-stray");
  expect(await click("http://unknown.click-pipeline.example/click-stray")).toBe(404);

  const orphans = await db.select({ domainId: clicks.domainId, slug: clicks.slug }).from(clicks).where(isNull(clicks.linkId));
  expect(orphans).toEqual(
    expect.arrayContaining([
      { domainId: null, slug: "click-gone" },
      { domainId: null, slug: "click-unknown" },
      { domainId: domain.id, slug: "click-typo" },
    ]),
  );
  expect(orphans.map((orphan) => orphan.slug)).not.toContain("favicon.ico");
  expect(await db.select().from(clicks).where(eq(clicks.slug, "click-stray"))).toEqual([]);
});

test("a failed Click insert still redirects", async () => {
  const link = await createLink("click-write-failure");
  await db.execute(sql`alter table clicks add constraint test_click_write check (slug <> 'click-write-failure')`);
  try {
    expect(await click("/click-write-failure")).toBe(302);
    expect(await storedClicks(link.id, 0)).toEqual([]);
  } finally {
    await db.execute(sql`alter table clicks drop constraint test_click_write`);
  }
});
