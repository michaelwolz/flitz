import { connectDb } from "@flitzlink/db";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import type { TestProject } from "vitest/node";

declare module "vitest" {
  export interface ProvidedContext {
    env: { DATABASE_URL: string; AUTH_SECRET: string; BASE_URL: string; TRUSTED_PROXIES: string };
  }
}

export default async function startContainers(project: TestProject) {
  const postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
  const db = await connectDb(postgres.getConnectionUri());
  await db.$client.end();
  project.provide("env", {
    DATABASE_URL: postgres.getConnectionUri(),
    AUTH_SECRET: "test-secret-of-at-least-32-characters",
    BASE_URL: "http://localhost:3000",
    TRUSTED_PROXIES: "1",
  });
  return () => postgres.stop();
}
