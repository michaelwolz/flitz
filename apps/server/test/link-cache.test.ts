import { connectAndMigrate, domains, eq, links } from "@flitzlink/db";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { call, testEnv, verifiedUser } from "./client.ts";

const env = await testEnv();
const replicaA = await createApp(env);
const replicaB = await createApp(env);
const db = await connectAndMigrate(env.DATABASE_URL);
afterAll(() => Promise.all([replicaA.close(), replicaB.close(), db.$client.end()]));

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
  return response.json();
}

async function redirect(replica: typeof replicaA, slug: string, origin = "") {
  const response = await replica.app.request(`${origin}/${slug}`);
  return response.headers.get("location") ?? response.status;
}

test("repeat redirects are served from the cache, not Postgres, until the Link changes through the API", async () => {
  const link = await api(replicaA, "POST", "/api/links", { defaultTarget: "https://example.com/cached" });
  expect(await redirect(replicaA, link.slug)).toBe("https://example.com/cached");

  await db.update(links).set({ defaultTarget: "https://example.com/changed" }).where(eq(links.id, link.id));
  expect(await redirect(replicaA, link.slug)).toBe("https://example.com/cached");
  expect(await redirect(replicaB, link.slug)).toBe("https://example.com/cached");

  await api(replicaA, "PATCH", `/api/links/${link.id}`, { title: "Touched" });
  expect(await redirect(replicaA, link.slug)).toBe("https://example.com/changed");
  await expect.poll(() => redirect(replicaB, link.slug)).toBe("https://example.com/changed");
});

test("an edit or deactivation on one replica changes the next redirect on another", async () => {
  const link = await api(replicaA, "POST", "/api/links", { defaultTarget: "https://example.com/old" });
  expect(await redirect(replicaB, link.slug)).toBe("https://example.com/old");

  await api(replicaA, "PATCH", `/api/links/${link.id}`, { defaultTarget: "https://example.com/new" });
  await expect.poll(() => redirect(replicaB, link.slug)).toBe("https://example.com/new");

  await api(replicaA, "POST", `/api/links/${link.id}/deactivate`);
  expect(await redirect(replicaA, link.slug)).toBe(404);
  await expect.poll(() => redirect(replicaB, link.slug)).toBe(404);

  await api(replicaB, "POST", `/api/links/${link.id}/reactivate`);
  expect(await redirect(replicaB, link.slug)).toBe("https://example.com/new");
  await expect.poll(() => redirect(replicaA, link.slug)).toBe("https://example.com/new");
});

test("an unknown Slug is cached as a miss until the Link changes through the API", async () => {
  expect(await redirect(replicaA, "miss234")).toBe(404);
  const [link] = await db.insert(links).values({ slug: "miss234", defaultTarget: "https://example.com/late" }).returning();
  expect(await redirect(replicaA, "miss234")).toBe(404);
  expect(await redirect(replicaB, "miss234")).toBe(404);

  await api(replicaA, "PATCH", `/api/links/${link.id}`, { title: "Found" });
  expect(await redirect(replicaA, "miss234")).toBe("https://example.com/late");
  await expect.poll(() => redirect(replicaB, "miss234")).toBe("https://example.com/late");
});

test("a Custom Domain is resolved from the cache, misses too, until the Domain changes through the API", async () => {
  const origin = "http://cached.example.org";
  expect(await redirect(replicaA, "nope234", origin)).toBe(404);
  const [domain] = await db
    .insert(domains)
    .values({ hostname: "cached.example.org", fallbackUrl: "https://example.org/first" })
    .returning();
  expect(await redirect(replicaA, "nope234", origin)).toBe(404);
  expect(await redirect(replicaB, "nope234", origin)).toBe("https://example.org/first");

  await db.update(domains).set({ fallbackUrl: "https://example.org/unseen" }).where(eq(domains.id, domain.id));
  expect(await redirect(replicaB, "nope234", origin)).toBe("https://example.org/first");

  await api(replicaA, "PATCH", `/api/domains/${domain.id}`, { fallbackUrl: "https://example.org/second" });
  expect(await redirect(replicaA, "nope234", origin)).toBe("https://example.org/second");
  await expect.poll(() => redirect(replicaB, "nope234", origin)).toBe("https://example.org/second");
});
