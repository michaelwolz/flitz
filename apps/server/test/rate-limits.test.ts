import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { type App, call, testEnv, verifiedUser } from "./client.ts";

const limits = await testEnv({ TRUSTED_PROXIES: "0", RATE_LIMIT_REDIRECTS_PER_MINUTE: "2" });
const replicaA = await createApp(limits);
const replicaB = await createApp(limits);
afterAll(() => Promise.all([replicaA.close(), replicaB.close()]));

test("short URLs are rate limited per client IP, across replicas on one Redis, whatever IP the client claims", async () => {
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
