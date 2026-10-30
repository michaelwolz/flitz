import { readFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

export { and, asc, desc, eq, gt, ilike, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
export * from "./schema.ts";

export type Db = Awaited<ReturnType<typeof connectDb>>;

export async function connectDb(url: string) {
  const client = postgres(url, { onnotice: () => {} });
  try {
    await client`select 1`.catch((cause) => {
      throw new Error("Cannot connect to Postgres", { cause });
    });
    await client.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext('flitz base schema'))`;
      const [{ initialized }] = await tx`select to_regclass('public.settings') is not null as initialized`;
      if (!initialized) await tx.unsafe(readFileSync(new URL("../schema.sql", import.meta.url), "utf8")).simple();
    });
    return drizzle({ client });
  } catch (error) {
    await client.end();
    throw error;
  }
}
