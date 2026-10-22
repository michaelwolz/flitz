import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

export { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
export * from "./schema.ts";

export type Db = Awaited<ReturnType<typeof connectAndMigrate>>;

export async function connectAndMigrate(url: string) {
  const db = drizzle({ connection: { url, onnotice: () => {} } });
  await db.execute(sql`select 1`).catch((cause) => {
    throw new Error("Cannot connect to Postgres", { cause });
  });
  const session = postgres(url, { max: 1, onnotice: () => {} });
  try {
    await session`select pg_advisory_lock(hashtext('flitz migrations'))`;
    await migrate(drizzle({ client: session }), { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  } finally {
    await session.end();
  }
  return db;
}
