import { randomUUID } from "node:crypto";
import { clicks, connectAndMigrate, eq, inArray, sessions, sql, users } from "@flitzlink/db";
import { createClient } from "redis";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { createPartitions } from "../src/clicks.ts";
import { runRetention } from "../src/retention.ts";
import { call, testEnv, verifiedUser } from "./client.ts";

const env = await testEnv();
const { app, close } = await createApp(env);
const db = await connectAndMigrate(env.DATABASE_URL);
const redis = await createClient({ url: env.REDIS_URL }).connect();
afterAll(() => Promise.all([close(), db.$client.end(), redis.close()]));
const admin = { cookie: (await verifiedUser(app, "retention-admin@example.com")).cookie };

const monthStart = (monthsAgo: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsAgo));
};
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);

async function insertClicks(times: Date[]) {
  await createPartitions(db, times);
  const rows = times.map((clickedAt) => ({
    id: randomUUID(),
    clickedAt,
    slug: "retention",
    deviceType: "desktop",
    query: {},
    bot: false,
    visitorHash: "retention",
  }));
  await db.insert(clicks).values(rows);
  return rows.map((row) => row.id);
}

test("the Retention job deletes Clicks older than the Retention Period and old sessions, keeps recent ones and drops fully expired partitions", async () => {
  expect((await call(app, admin, "GET", "/api/settings")).body.retentionMonths).toBe(13);
  expect((await call(app, admin, "PATCH", "/api/settings", { retentionMonths: 6 })).body.retentionMonths).toBe(6);
  const expired = await insertClicks([monthStart(20), monthStart(6)]);
  const recent = await insertClicks([monthStart(5), yesterday]);

  const [user] = await db.insert(users).values({ name: "Sessions", email: "retention-sessions@example.com" }).returning();
  const expiredDaysAgo = (days: number) => ({
    userId: user.id,
    token: randomUUID(),
    expiresAt: new Date(Date.now() - days * 24 * 60 * 60 * 1000),
  });
  await db.insert(sessions).values([expiredDaysAgo(31), expiredDaysAgo(29)]);

  expect(await runRetention(db, redis)).toBe(true);
  expect(await runRetention(db, redis)).toBe(false);

  const left = await db
    .select({ id: clicks.id })
    .from(clicks)
    .where(inArray(clicks.id, [...expired, ...recent]));
  expect(left.map((row) => row.id).toSorted()).toEqual(recent.toSorted());
  const sessionsLeft = await db.select({ expiresAt: sessions.expiresAt }).from(sessions).where(eq(sessions.userId, user.id));
  expect(sessionsLeft.map(({ expiresAt }) => Math.round((Date.now() - expiresAt.getTime()) / (24 * 60 * 60 * 1000)))).toEqual([29]);
  const partition = (monthsAgo: number) => `clicks_${monthStart(monthsAgo).toISOString().slice(0, 7).replace("-", "_")}`;
  const [{ dropped, straddling }] = await db.execute(
    sql`select to_regclass(${partition(20)}) as dropped, to_regclass(${partition(6)}) as straddling`,
  );
  expect(dropped).toBeNull();
  expect(straddling).toBe(partition(6));
});

test("the Retention Period is at most 120 months", async () => {
  const tooLong = await call(app, admin, "PATCH", "/api/settings", { retentionMonths: 121 });
  expect(tooLong).toMatchObject({ status: 400, body: { message: "retentionMonths: Choose a whole number of months from 1 to 120." } });
  expect((await call(app, admin, "PATCH", "/api/settings", { retentionMonths: 120 })).body.retentionMonths).toBe(120);
});

test("worker replicas creating the same Click partitions at once all succeed", async () => {
  const month = [new Date(Date.UTC(2031, 0, 15))];
  await expect(Promise.all(Array.from({ length: 8 }, () => createPartitions(db, month)))).resolves.toHaveLength(8);
});
