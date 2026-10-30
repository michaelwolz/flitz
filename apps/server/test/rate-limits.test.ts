import { connectDb, sql } from "@flitzlink/db";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { type App, call, testEnv, verifiedUser } from "./client.ts";

const limits = await testEnv({ TRUSTED_PROXIES: "0", RATE_LIMIT_REDIRECTS_PER_MINUTE: "2" });
const replicaA = await createApp(limits);
const replicaB = await createApp(limits);
afterAll(() => Promise.all([replicaA.close(), replicaB.close()]));

test("short URLs are rate limited per client IP, across replicas on one Postgres, whatever IP the client claims", async () => {
  const signedIn = { cookie: (await verifiedUser(replicaA.app, "member-rate@example.com")).cookie };
  const { body: link } = await call(replicaA.app, signedIn, "POST", "/api/links", { defaultTarget: "https://example.com/rate" });

  const visit = (replica: App, socketIp: string, forgedIp: string) =>
    replica.request(
      `/${link.slug}`,
      { headers: { "x-forwarded-for": forgedIp, "x-flitz-client-ip": forgedIp } },
      { incoming: { socket: { remoteAddress: socketIp } } },
    );
  expect((await visit(replicaA.app, "198.51.100.7", "203.0.113.1")).status).toBe(302);
  expect((await visit(replicaB.app, "198.51.100.7", "203.0.113.2")).status).toBe(302);
  const limited = await visit(replicaA.app, "198.51.100.7", "203.0.113.3");
  expect(limited.status).toBe(429);
  expect(await limited.text()).toContain("Wait a minute");
  expect((await visit(replicaB.app, "198.51.100.8", "203.0.113.3")).status).toBe(302);
});

test("concurrent requests share an atomic limit that survives a restart and resets after expiry", async () => {
  const ip = "198.51.100.20";
  const visit = (replica: App) => replica.request("/rate-concurrent", {}, { incoming: { socket: { remoteAddress: ip } } });
  const responses = await Promise.all(Array.from({ length: 12 }, (_, i) => visit(i % 2 ? replicaA.app : replicaB.app)));
  expect(responses.filter((response) => response.status === 404)).toHaveLength(2);
  expect(responses.filter((response) => response.status === 429)).toHaveLength(10);
  const restarted = await createApp({ ...limits, TRUSTED_PROXIES: "1" });
  const visitRestart = () => restarted.app.request("/rate-concurrent", { headers: { "x-forwarded-for": ip } });
  const db = await connectDb(limits.DATABASE_URL);
  try {
    expect((await visitRestart()).status).toBe(429);
    const counters = await db.execute(sql`select key from rate_limits`);
    expect(JSON.stringify(counters)).not.toContain(ip);
    await db.execute(sql`update rate_limits set expires_at = now() - interval '1 second'`);
    expect((await visitRestart()).status).toBe(404);
    expect((await visit(replicaB.app)).status).toBe(404);
    expect((await visit(replicaA.app)).status).toBe(429);
  } finally {
    await restarted.close();
    await db.$client.end();
  }
}, 15_000);

test("unavailable rate counters fail closed for redirects and authentication", async () => {
  const db = await connectDb(limits.DATABASE_URL);
  await db.execute(sql`alter table rate_limits rename to unavailable_rate_limits`);
  const incoming = { incoming: { socket: { remoteAddress: "198.51.100.99" } } };
  try {
    expect((await replicaA.app.request("/rate-unavailable", {}, incoming)).status).toBe(500);
    const signIn = await replicaA.app.request(
      "/api/auth/sign-in/email",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "member-rate@example.com", password: "wrong password" }),
      },
      incoming,
    );
    expect(signIn.status).toBe(500);
  } finally {
    await db.execute(sql`alter table unavailable_rate_limits rename to rate_limits`);
    await db.$client.end();
  }
});
