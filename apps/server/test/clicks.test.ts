import { asc, clicks, connectAndMigrate, domains, eq, isNull, links } from "@flitzlink/db";
import { createClient } from "redis";
import { afterAll, expect, test, vi } from "vitest";
import { createApp } from "../src/app.ts";
import { processPendingClicks } from "../src/clicks.ts";
import { testEnv } from "./client.ts";

const env = await testEnv();
const ip = "203.0.113.7";
const { app, close } = await createApp(env, { lookupLocation: (address) => (address === ip ? { country: "DE", region: "BY" } : {}) });
const db = await connectAndMigrate(env.DATABASE_URL);
const redis = await createClient({ url: env.REDIS_URL }).connect();
afterAll(() => Promise.all([close(), db.$client.end(), redis.close()]));

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

function processedClicks(linkId: string, count: number) {
  return vi.waitFor(async () => {
    await processPendingClicks(db, redis, "test-worker");
    const rows = await db.select().from(clicks).where(eq(clicks.linkId, linkId)).orderBy(asc(clicks.clickedAt), asc(clicks.id));
    expect(rows).toHaveLength(count);
    return rows;
  });
}

const waitingClicks = async () => JSON.stringify(await redis.xRange("clicks", "-", "+"));

test("a redirect records a Click with its facts and Visitor Hash but never the IP", async () => {
  const link = await createLink("click-fields");
  const status = await click("/Click-Fields?utm_source=flyer&lang=de", { referer: "https://news.example.org/a?id=1" });
  expect(status).toBe(302);
  await vi.waitFor(async () => expect(await waitingClicks()).toContain("click-fields"));
  expect(await waitingClicks()).not.toContain(ip);

  const [row] = await processedClicks(link.id, 1);
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
  expect((await processedClicks(link.id, 5)).map((row) => row.bot)).toEqual([true, true, true, true, true]);
});

test("the same visitor gets the same Visitor Hash until the daily salt rotates at the end of the UTC day", async () => {
  const link = await createLink("click-visitors");
  const now = new Date();
  await click("/click-visitors?n=first");
  await click("/click-visitors?n=again");
  await click("/click-visitors?n=other", { "x-forwarded-for": "198.51.100.1" });
  const endOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  await vi.waitFor(async () => expect(await redis.expireTime(`visitor-salt:${now.toISOString().slice(0, 10)}`)).toBe(endOfDay / 1000));
  vi.useFakeTimers({ toFake: ["Date"], now: endOfDay });
  await click("/click-visitors?n=tomorrow").finally(() => vi.useRealTimers());

  const hash = Object.fromEntries((await processedClicks(link.id, 4)).map((row) => [row.query.n, row.visitorHash]));
  expect(hash.again).toBe(hash.first);
  expect(hash.other).not.toBe(hash.first);
  expect(hash.tomorrow).not.toBe(hash.first);
});

test("Clicks a crashed worker read but never inserted are claimed and inserted by another worker", async () => {
  const link = await createLink("click-crash");
  await click("/click-crash");
  await vi.waitFor(async () => expect(await waitingClicks()).toContain("click-crash"));
  const unreachableDb = await connectAndMigrate(env.DATABASE_URL);
  await unreachableDb.$client.end();
  await expect(processPendingClicks(unreachableDb, redis, "crashed-worker")).rejects.toThrow(/CONNECTION_ENDED/);
  expect(await processedClicks(link.id, 0)).toEqual([]);

  await processPendingClicks(db, redis, "test-worker", 0);
  expect(await processedClicks(link.id, 1)).toHaveLength(1);
});

test("a Click Postgres rejects is dropped without holding up the Clicks behind it", async () => {
  const link = await createLink("click-poison");
  const fromBeforeTheFix = {
    slug: "click-poison",
    linkId: link.id,
    deviceType: "desktop",
    query: { x: "\0" },
    bot: false,
    visitorHash: "v",
  };
  await redis.xAdd("clicks", "*", { click: JSON.stringify(fromBeforeTheFix) });
  await click("/click-poison?x=a%00b");
  await click("/click-poison?after=1");

  expect((await processedClicks(link.id, 2)).map((row) => row.query)).toEqual(expect.arrayContaining([{ x: "ab" }, { after: "1" }]));
  expect(JSON.stringify(await redis.xRange("clicks", "-", "+"))).not.toContain("click-poison");
  expect((await redis.xPending("clicks", "click-worker")).pending).toBe(0);
});

test("a Click keeps at most 20 query parameters of 256 characters each, and 2 KB of them in all", async () => {
  const link = await createLink("click-query-cap");
  const params = (value: string) => Array.from({ length: 30 }, (_, i) => `p${i}=${value}`).join("&");
  await click(`/click-query-cap?${params("1")}`);
  await click(`/click-query-cap?${params("v".repeat(300))}`);

  const kept = (count: number, value: string) => Object.fromEntries(Array.from({ length: count }, (_, i) => [`p${i}`, value]));
  expect((await processedClicks(link.id, 2)).map((row) => row.query)).toEqual(
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

  const orphans = await vi.waitFor(async () => {
    await processPendingClicks(db, redis, "test-worker");
    const orphans = await db.select({ domainId: clicks.domainId, slug: clicks.slug }).from(clicks).where(isNull(clicks.linkId));
    expect(orphans).toEqual(
      expect.arrayContaining([
        { domainId: null, slug: "click-gone" },
        { domainId: null, slug: "click-unknown" },
        { domainId: domain.id, slug: "click-typo" },
      ]),
    );
    return orphans;
  });
  expect(orphans.map((orphan) => orphan.slug)).not.toContain("favicon.ico");
  expect(await db.select().from(clicks).where(eq(clicks.slug, "click-stray"))).toEqual([]);
});
