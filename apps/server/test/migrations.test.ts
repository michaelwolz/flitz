import { readdir } from "node:fs/promises";
import { connectAndMigrate, sql } from "@flitzlink/db";
import { expect, inject, test } from "vitest";

test("processes starting at once against an empty database migrate it once and all start", async () => {
  const admin = await connectAndMigrate(inject("env").DATABASE_URL);
  await admin.execute(sql`create database concurrent_start`);
  await admin.$client.end();
  const url = new URL(inject("env").DATABASE_URL);
  url.pathname = "/concurrent_start";

  const [server, worker] = await Promise.all([connectAndMigrate(url.href), connectAndMigrate(url.href)]);

  const migrations = (await readdir(new URL("../../../packages/db/drizzle", import.meta.url))).filter((name) => name.endsWith(".sql"));
  const [applied] = await server.execute<{ count: number }>(sql`select count(*)::int as count from drizzle.__drizzle_migrations`);
  expect(applied.count).toBe(migrations.length);
  await Promise.all([server.$client.end(), worker.$client.end()]);
});
