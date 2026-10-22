import { connectAndMigrate } from "@flitzlink/db";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { RedisContainer } from "@testcontainers/redis";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    env: { DATABASE_URL: string; REDIS_URL: string; AUTH_SECRET: string; BASE_URL: string; TRUSTED_PROXIES: string };
  }
}

export default async function startContainers(project: TestProject) {
  const [postgres, redis] = await Promise.all([
    new PostgreSqlContainer("postgres:18-alpine").start(),
    new RedisContainer("redis:8-alpine").withCommand(["redis-server", "--databases", "64"]).start(),
  ]);
  const db = await connectAndMigrate(postgres.getConnectionUri());
  await db.$client.end();
  project.provide("env", {
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    AUTH_SECRET: "test-secret-of-at-least-32-characters",
    BASE_URL: "http://localhost:3000",
    TRUSTED_PROXIES: "1",
  });
  return () => Promise.all([postgres.stop(), redis.stop()]);
}
