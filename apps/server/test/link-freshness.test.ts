import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { call, testEnv, verifiedUser } from "./client.ts";

const env = await testEnv();
const replicaA = await createApp(env);
const replicaB = await createApp(env);
afterAll(() => Promise.all([replicaA.close(), replicaB.close()]));

const { cookie } = await verifiedUser(replicaA.app, "cache@example.com");
const { key } = (
  await call(replicaA.app, { cookie }, "POST", "/api/api-keys", { name: "Test", scopes: ["links:read", "links:write", "domains:write"] })
).body;

async function api(replica: typeof replicaA, method: string, path: string, body?: object) {
  const response = await replica.app.request(path, {
    method,
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
  expect(response.ok).toBe(true);
  return response.status === 204 ? null : response.json();
}

async function redirect(replica: typeof replicaA, slug: string, origin = "") {
  const response = await replica.app.request(`${origin}/${slug}`);
  return response.headers.get("location") ?? response.status;
}

test("an edit or deactivation on one replica changes the next redirect on another", async () => {
  const link = await api(replicaA, "POST", "/api/links", { defaultTarget: "https://example.com/old" });
  expect(await redirect(replicaB, link.slug)).toBe("https://example.com/old");

  await api(replicaA, "PATCH", `/api/links/${link.id}`, { defaultTarget: "https://example.com/new" });
  expect(await redirect(replicaB, link.slug)).toBe("https://example.com/new");

  await api(replicaA, "POST", `/api/links/${link.id}/deactivate`);
  expect(await redirect(replicaA, link.slug)).toBe(404);
  expect(await redirect(replicaB, link.slug)).toBe(404);

  await api(replicaB, "POST", `/api/links/${link.id}/reactivate`);
  expect(await redirect(replicaB, link.slug)).toBe("https://example.com/new");
  expect(await redirect(replicaA, link.slug)).toBe("https://example.com/new");
});

test("new Links, Domain additions, fallback edits and deletions are immediately visible across replicas", async () => {
  expect(await redirect(replicaB, "miss234")).toBe(404);
  const link = await api(replicaA, "POST", "/api/links", { slug: "miss234", defaultTarget: "https://example.com/late" });
  expect(await redirect(replicaB, link.slug)).toBe("https://example.com/late");
  const origin = "http://fresh.example.org";
  expect(await redirect(replicaB, "unknown", origin)).toBe(404);
  const domain = await api(replicaA, "POST", "/api/domains", { hostname: "fresh.example.org", fallbackUrl: "https://example.org/first" });
  expect(await redirect(replicaB, "unknown", origin)).toBe("https://example.org/first");
  await api(replicaA, "PATCH", `/api/domains/${domain.id}`, { fallbackUrl: "https://example.org/second" });
  expect(await redirect(replicaB, "unknown", origin)).toBe("https://example.org/second");
  expect((await call(replicaA.app, { cookie }, "DELETE", `/api/domains/${domain.id}`)).status).toBe(204);
  expect(await redirect(replicaB, "unknown", origin)).toBe(404);
  await api(replicaA, "POST", `/api/links/${link.id}/deactivate`);
  expect((await call(replicaA.app, { cookie }, "DELETE", `/api/links/${link.id}`)).status).toBe(204);
  expect(await redirect(replicaB, link.slug)).toBe(404);
});
