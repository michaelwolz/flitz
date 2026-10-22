import { readFileSync } from "node:fs";
import { connectAndMigrate } from "@flitzlink/db";
import { createClient } from "redis";

export const version: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

export function required(env: NodeJS.ProcessEnv, name: string) {
  const value = env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

export function lowercaseList(env: NodeJS.ProcessEnv, name: string) {
  return (env[name] ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

export function positiveInteger(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number above 0`);
  return value;
}

export function wholeNumber(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = Number(env[name] || fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a whole number of 0 or more`);
  return value;
}

export async function connectStores(env: NodeJS.ProcessEnv) {
  const databaseUrl = required(env, "DATABASE_URL");
  const redisUrl = required(env, "REDIS_URL");
  const [db, redis] = await Promise.all([
    connectAndMigrate(databaseUrl),
    createClient({ url: redisUrl })
      .connect()
      .catch((cause) => {
        throw new Error("Cannot connect to Redis", { cause });
      }),
  ]);
  redis.on("error", (error) => console.error("Redis error:", error));
  return { db, redis };
}
