import { connectDb, sql } from "@flitzlink/db";
import { expect, inject, test } from "vitest";

test("processes starting at once against an empty database initialize it once and all start", async () => {
  const admin = await connectDb(inject("env").DATABASE_URL);
  await admin.execute(sql`create database concurrent_start`);
  await admin.$client.end();
  const url = new URL(inject("env").DATABASE_URL);
  url.pathname = "/concurrent_start";

  const [server, worker] = await Promise.all([connectDb(url.href), connectDb(url.href)]);

  const [initialized] = await server.execute<{ count: number }>(sql`select count(*)::int as count from settings`);
  expect(initialized.count).toBe(1);
  await server.execute(sql`update settings set retention_months = 6`);
  const reopened = await connectDb(url.href);
  const [settings] = await reopened.execute<{ retentionMonths: number }>(sql`select retention_months as "retentionMonths" from settings`);
  expect(settings.retentionMonths).toBe(6);
  await reopened.$client.end();
  await Promise.all([server.$client.end(), worker.$client.end()]);
});
