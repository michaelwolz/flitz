import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { createApp } from "../../server/src/app.ts";

export default async function startServer() {
  const postgres = await new PostgreSqlContainer("postgres:18-alpine").start();
  const emails: string[] = [];
  const log = console.log;
  console.log = (...args) => {
    if (String(args[0]).startsWith("Email to ")) emails.push(String(args[0]));
    log(...args);
  };
  let flitz: Awaited<ReturnType<typeof createApp>> | undefined;
  const server = serve({
    fetch: (request, env) => (new URL(request.url).pathname === "/e2e/emails" ? Response.json(emails) : flitz!.app.fetch(request, env)),
    port: 0,
  });
  await once(server, "listening");
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  flitz = await createApp({
    DATABASE_URL: postgres.getConnectionUri(),
    AUTH_SECRET: "e2e-secret-of-at-least-32-characters",
    BASE_URL: url,
    TRUSTED_PROXIES: "1",
    SIGNUP_DOMAINS: "example.com",
    DEFAULT_ROLE: "admin",
  });
  process.env.FLITZ_URL = url;
  return async () => {
    server.close();
    await flitz?.close();
    await postgres.stop();
  };
}
