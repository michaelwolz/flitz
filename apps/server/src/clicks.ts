import { createHmac, randomBytes } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout } from "node:timers/promises";
import { clicks, type Db, sql } from "@flitzlink/db";
import type { Context } from "hono";
import type { RedisClientType } from "redis";
import { connectStores } from "./env.ts";
import { clientIp, type RequestFacts } from "./redirect-rules.ts";
import { runRetention } from "./retention.ts";

type Click = Omit<typeof clicks.$inferInsert, "id" | "clickedAt">;
type ShortUrl = Pick<Click, "linkId" | "domainId" | "slug">;

const stream = "clicks";
const group = "click-worker";
const batchSize = 1000;
const pollIntervalMs = 1000;
const claimIdleMs = 60_000;
const retentionCheckMs = 60 * 60 * 1000;
const maxWaitingClicks = 100_000;
const maxQueryParams = 20;
const maxTextLength = 256;
const maxQueryBytes = 2048;
const createdPartitions = new Set<number>();

const clean = (text: string) =>
  text
    .replace(/\p{Cc}/gu, "")
    .slice(0, maxTextLength)
    .toWellFormed();

export async function recordClick(redis: RedisClientType, c: Context, facts: RequestFacts, shortUrl: ShortUrl) {
  const userAgent = c.req.header("user-agent") ?? "";
  const click: Click = {
    ...shortUrl,
    deviceType: clean(facts.deviceType),
    os: facts.os && clean(facts.os),
    browser: facts.browser && clean(facts.browser),
    country: facts.country,
    region: facts.region,
    referrerDomain: clean(URL.parse(c.req.header("referer") ?? "")?.hostname ?? "") || null,
    query: cappedQuery(facts.query),
    bot: facts.bot,
    visitorHash: await visitorHash(redis, clientIp(c) ?? "", userAgent),
  };
  await redis.xAdd(
    stream,
    "*",
    { click: JSON.stringify(click) },
    { TRIM: { strategy: "MAXLEN", strategyModifier: "~", threshold: maxWaitingClicks } },
  );
}

function cappedQuery(params: URLSearchParams) {
  let query: Record<string, string> = {};
  for (const [key, value] of [...params].slice(0, maxQueryParams)) {
    const next = { ...query, [clean(key)]: clean(value) };
    if (Buffer.byteLength(JSON.stringify(next)) > maxQueryBytes) break;
    query = next;
  }
  return query;
}

let dailySalt: { day: string; salt: Promise<string> } | undefined;

function saltOfToday(redis: RedisClientType) {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (dailySalt?.day === day) return dailySalt.salt;
  const fresh = randomBytes(32).toString("base64");
  const endOfDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1) / 1000;
  const salt = redis.set(`visitor-salt:${day}`, fresh, { condition: "NX", GET: true, expiration: { type: "EXAT", value: endOfDay } }).then(
    (stored) => stored ?? fresh,
    (error) => {
      dailySalt = undefined;
      throw error;
    },
  );
  dailySalt = { day, salt };
  return salt;
}

async function visitorHash(redis: RedisClientType, ip: string, userAgent: string) {
  return createHmac("sha256", await saltOfToday(redis))
    .update(`${ip}\n${userAgent}`)
    .digest("base64url");
}

export async function processPendingClicks(db: Db, redis: RedisClientType, consumer: string, minIdleMs = claimIdleMs) {
  const claim = () => redis.xAutoClaim(stream, group, consumer, minIdleMs, "0-0", { COUNT: batchSize });
  const claimed = await claim().catch(async (error: Error) => {
    if (!error.message.startsWith("NOGROUP")) throw error;
    await redis.xGroupCreate(stream, group, "0", { MKSTREAM: true }).catch((error: Error) => {
      if (!error.message.startsWith("BUSYGROUP")) throw error;
    });
    return claim();
  });
  const read = await redis.xReadGroup(group, consumer, { key: stream, id: ">" }, { COUNT: batchSize });
  const entries = [...claimed.messages, ...(read?.[0]?.messages ?? [])].filter((entry) => entry !== null);
  if (entries.length === 0) return 0;

  const rows = entries.map(({ id, message }) => ({
    ...(JSON.parse(message.click) as Click),
    id,
    clickedAt: new Date(Number(id.split("-")[0])),
  }));
  await createPartitions(
    db,
    rows.map((row) => row.clickedAt),
  );
  await db
    .transaction((tx) => tx.insert(clicks).values(rows).onConflictDoNothing())
    .catch(() => {
      createdPartitions.clear();
      return insertOneByOne(db, rows);
    });
  const ids = entries.map(({ id }) => id);
  await redis.multi().xAck(stream, group, ids).xDel(stream, ids).exec();
  return entries.length;
}

async function insertOneByOne(db: Pick<Db, "transaction">, rows: (typeof clicks.$inferInsert)[]) {
  for (const row of rows) {
    await db
      .transaction((tx) => tx.insert(clicks).values(row).onConflictDoNothing())
      .catch((error: Error) => {
        const cause = error.cause as { code?: string; message?: string } | undefined;
        if (!cause?.code?.match(/^(22|23502)/)) throw error;
        console.error(`Dropping Click ${row.id}, which Postgres rejects: ${cause.message}`);
      });
  }
}

export async function createPartitions(db: Db, times: Date[]) {
  const monthStart = (time: Date, offset = 0) => new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth() + offset));
  const now = new Date();
  const months = new Set([...times, now, monthStart(now, 1)].map((time) => monthStart(time).getTime()));
  for (const month of createdPartitions) months.delete(month);
  if (months.size === 0) return;
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('flitz click partitions'))`);
    for (const month of months) {
      const from = new Date(month);
      const name = `clicks_${from.toISOString().slice(0, 7).replace("-", "_")}`;
      await tx.execute(
        sql.raw(
          `create table if not exists ${name} partition of clicks for values from ('${from.toISOString()}') to ('${monthStart(from, 1).toISOString()}')`,
        ),
      );
    }
  });
  for (const month of months) createdPartitions.add(month);
}

export async function runClickWorker(env: NodeJS.ProcessEnv) {
  const { db, redis } = await connectStores(env);
  const stop = new AbortController();
  process.on("SIGTERM", () => stop.abort());
  const retention = setInterval(
    () => runRetention(db, redis).catch((error) => console.error("Cannot apply the Retention Period:", error)),
    retentionCheckMs,
  );
  console.log("flitz worker processing Clicks");
  while (!stop.signal.aborted) {
    const processed = await processPendingClicks(db, redis, hostname()).catch((error) => {
      console.error("Cannot process Clicks:", error);
      return 0;
    });
    if (processed < batchSize) await setTimeout(pollIntervalMs);
  }
  clearInterval(retention);
  await Promise.all([redis.close(), db.$client.end()]);
}
