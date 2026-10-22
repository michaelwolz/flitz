import { hostname } from "node:os";
import { clicks, type Db, lt, sessions, sql } from "@flitzlink/db";
import type { RedisClientType } from "redis";
import { readSettings } from "./settings.ts";

const lockTtlSeconds = 2 * 24 * 60 * 60;
const sessionRetentionDays = 30;
const monthsAgo = (months: number) => sql`now() - make_interval(months => ${months})`;

export async function runRetention(db: Db, redis: RedisClientType) {
  const lock = `retention:${new Date().toISOString().slice(0, 10)}`;
  const acquired = await redis.set(lock, hostname(), { condition: "NX", expiration: { type: "EX", value: lockTtlSeconds } });
  if (!acquired) return false;
  await Promise.all([deleteExpiredClicks(db), deleteExpiredSessions(db)]).catch(async (error) => {
    await redis.del(lock);
    throw error;
  });
  return true;
}

async function deleteExpiredClicks(db: Db) {
  const { retentionMonths } = await readSettings(db);
  const partitions = await db.execute<{ name: string }>(
    sql`select inhrelid::regclass::text as name from pg_inherits where inhparent = 'clicks'::regclass`,
  );
  const expired = partitions
    .map(({ name }) => ({ name, month: name.match(/^clicks_(\d{4})_(\d{2})$/) }))
    .filter(({ month }) => month && Date.UTC(Number(month[1]), Number(month[2]) + retentionMonths) <= Date.now());
  for (const { name } of expired) await db.execute(sql.raw(`drop table if exists ${name}`));

  const { count } = await db.delete(clicks).where(lt(clicks.clickedAt, monthsAgo(retentionMonths)));
  const dropped = expired.map(({ name }) => name).join(", ") || "none";
  console.log(`Retention deleted ${count} Clicks and dropped partitions: ${dropped}`);
}

async function deleteExpiredSessions(db: Db) {
  const { count } = await db.delete(sessions).where(lt(sessions.expiresAt, sql`now() - make_interval(days => ${sessionRetentionDays})`));
  console.log(`Retention deleted ${count} sessions that expired more than ${sessionRetentionDays} days ago`);
}
