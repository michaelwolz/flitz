import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { clicks, type Db, sql } from "@flitzlink/db";
import type { Context } from "hono";
import { clientIp, type RequestFacts } from "./redirect-rules.ts";

type Click = Omit<typeof clicks.$inferInsert, "id" | "clickedAt">;
type ShortUrl = Pick<Click, "linkId" | "domainId" | "slug">;

const maxQueryParams = 20;
const maxTextLength = 256;
const maxQueryBytes = 2048;
const createdPartitions = new WeakMap<Db, Set<number>>();
export const utcToday = sql`(statement_timestamp() at time zone 'UTC')::date::text`;
const clickedAtOfSalt = sql`greatest(statement_timestamp(), day::date::timestamp at time zone 'UTC') as "clickedAt"`;

const clean = (text: string) =>
  text
    .replace(/\p{Cc}/gu, "")
    .slice(0, maxTextLength)
    .toWellFormed();

export async function recordClick(db: Db, c: Context, facts: RequestFacts, shortUrl: ShortUrl) {
  const userAgent = c.req.header("user-agent") ?? "";
  const { visitorHash: hash, clickedAt } = await visitorHash(db, clientIp(c) ?? "", userAgent);
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
    visitorHash: hash,
  };
  await createPartitions(db, [clickedAt]);
  await db.insert(clicks).values({ ...click, id: randomUUID(), clickedAt });
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

async function visitorHash(db: Db, ip: string, userAgent: string) {
  const [current] = await db.execute<{ salt: string; clickedAt: string }>(sql`
    select salt, ${clickedAtOfSalt} from visitor_salt
    where day >= ${utcToday}
  `);
  const { salt, clickedAt } = current ?? (await rotateSalt(db));
  return { visitorHash: createHmac("sha256", salt).update(`${ip}\n${userAgent}`).digest("base64url"), clickedAt: new Date(clickedAt) };
}

async function rotateSalt(db: Db) {
  // A pre-midnight statement may wait behind a new-day request: never rotate backwards.
  const [rotated] = await db.execute<{ salt: string; clickedAt: string }>(sql`
    insert into visitor_salt (id, day, salt)
    values (1, ${utcToday}, ${randomBytes(32).toString("base64")})
    on conflict (id) do update set
      salt = case when visitor_salt.day >= excluded.day then visitor_salt.salt else excluded.salt end,
      day = greatest(visitor_salt.day, excluded.day)
    returning salt, ${clickedAtOfSalt}
  `);
  return rotated;
}

export async function createPartitions(db: Db, times: Date[]) {
  const monthStart = (time: Date, offset = 0) => new Date(Date.UTC(time.getUTCFullYear(), time.getUTCMonth() + offset));
  const now = new Date();
  const months = new Set([...times, now, monthStart(now, 1)].map((time) => monthStart(time).getTime()));
  const created = createdPartitions.get(db) ?? new Set<number>();
  for (const month of created) months.delete(month);
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
  for (const month of months) created.add(month);
  createdPartitions.set(db, created);
}
