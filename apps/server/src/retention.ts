import { setTimeout } from "node:timers/promises";
import { clicks, connectDb, type Db, lt, sessions, sql } from "@flitzlink/db";
import { required } from "./env.ts";
import { utcToday } from "./clicks.ts";
import { readSettings } from "./settings.ts";

const sessionRetentionDays = 30;
const monthsAgo = (months: number) => sql`now() - make_interval(months => ${months})`;

type MaintenanceDb = Pick<Db, "select" | "delete" | "execute">;

export async function runRetention(db: Db) {
  return db.transaction(async (tx) => {
    const [{ acquired }] = await tx.execute<{ acquired: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext('flitz maintenance')) as acquired`,
    );
    if (!acquired) return false;
    await tx.execute(sql`delete from rate_limits where expires_at <= statement_timestamp()`);
    await tx.execute(sql`delete from visitor_salt where day < ${utcToday}`);
    const [{ needed }] = await tx.execute<{ needed: boolean }>(sql`
      select not exists (select 1 from maintenance_runs where day = ${utcToday}) as needed
    `);
    if (!needed) return false;
    await deleteExpiredClicks(tx);
    await deleteExpiredSessions(tx);
    await tx.execute(sql`delete from maintenance_runs`);
    await tx.execute(sql`insert into maintenance_runs (day) values (${utcToday})`);
    return true;
  });
}

export async function runMaintenanceWorker(env: NodeJS.ProcessEnv) {
  const db = await connectDb(required(env, "DATABASE_URL"));
  const stop = new AbortController();
  process.once("SIGTERM", () => stop.abort());
  console.log("flitz worker running scheduled maintenance");
  try {
    while (!stop.signal.aborted) {
      await runRetention(db).catch((error) => console.error("Cannot apply the Retention Period:", error));
      await setTimeout(60 * 60 * 1000, undefined, { signal: stop.signal }).catch((error) => {
        if (!stop.signal.aborted) throw error;
      });
    }
  } finally {
    await db.$client.end();
  }
}

async function deleteExpiredClicks(db: MaintenanceDb) {
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

async function deleteExpiredSessions(db: MaintenanceDb) {
  const { count } = await db.delete(sessions).where(lt(sessions.expiresAt, sql`now() - make_interval(days => ${sessionRetentionDays})`));
  console.log(`Retention deleted ${count} sessions that expired more than ${sessionRetentionDays} days ago`);
}
