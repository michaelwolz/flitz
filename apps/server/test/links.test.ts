import { clicks, connectAndMigrate, eq } from "@flitzlink/db";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { createPartitions } from "../src/clicks.ts";
import { call, testEnv, verifiedUser } from "./client.ts";

const env = await testEnv();
const { app, close } = await createApp(env);
const db = await connectAndMigrate(env.DATABASE_URL);
afterAll(() => Promise.all([close(), db.$client.end()]));

async function createLink(headers: Record<string, string>, body: object) {
  const { status, body: link } = await call(app, headers, "POST", "/api/links", body);
  expect(status).toBe(201);
  return link;
}

test("a Link created with an API Key redirects from its Short URL; the key is shown only once and can be revoked", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-key@example.com")).cookie };
  const created = await call(app, owner, "POST", "/api/api-keys", { name: "CI", scopes: ["links:read", "links:write"] });
  expect(created.status).toBe(201);
  const key = { authorization: `Bearer ${created.body.key}` };

  const link = await createLink(key, { defaultTarget: "https://example.com/spring?lang=en", title: "Spring flyer" });
  expect(link.slug).toMatch(/^[2-9a-hjkmnp-z]{7}$/);
  expect(link.shortUrl).toBe(`http://localhost:3000/${link.slug}`);
  const redirect = await app.request(`/${link.slug}`);
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("location")).toBe("https://example.com/spring?lang=en");

  const listed = await call(app, owner, "GET", "/api/api-keys");
  expect(listed.body.apiKeys).toEqual([
    {
      id: created.body.id,
      name: "CI",
      scopes: ["links:read", "links:write"],
      start: created.body.key.slice(0, 10),
      createdBy: "owner-key",
      createdAt: expect.any(String),
    },
  ]);

  expect((await call(app, owner, "DELETE", `/api/api-keys/${created.body.id}`)).status).toBe(204);
  expect((await call(app, key, "GET", "/api/links")).status).toBe(401);
});

test("an API Key without the needed Scope is refused with 403", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-scope@example.com")).cookie };
  const { body } = await call(app, owner, "POST", "/api/api-keys", { name: "Reporting", scopes: ["links:read"] });
  const key = { authorization: `Bearer ${body.key}` };

  expect((await call(app, key, "GET", "/api/links")).status).toBe(200);
  const denied = await call(app, key, "POST", "/api/links", { defaultTarget: "https://example.com" });
  expect(denied.status).toBe(403);
  expect(denied.body.message).toContain("links:write");
});

test("a viewer can read Links but not change them", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-viewer@example.com")).cookie };
  const link = await createLink(owner, { defaultTarget: "https://example.com" });
  await call(app, owner, "POST", "/api/users/invitations", { email: "viewer@example.com", role: "viewer" });
  const viewer = { cookie: (await verifiedUser(app, "viewer@example.com")).cookie };

  expect((await call(app, viewer, "GET", `/api/links/${link.id}`)).body).toEqual(link);
  expect((await call(app, viewer, "PATCH", `/api/links/${link.id}`, { title: "Mine now" })).status).toBe(403);
  expect((await call(app, viewer, "POST", "/api/api-keys", { name: "Sneaky", scopes: ["links:write"] })).status).toBe(403);
});

test("a changed Default Target applies at once; deactivating stops the redirect and reactivating restores it", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-active@example.com")).cookie };
  const link = await createLink(owner, { defaultTarget: "https://example.com/old" });
  await call(app, owner, "PATCH", `/api/links/${link.id}`, { defaultTarget: "https://example.com/new" });
  expect((await app.request(`/${link.slug}`)).headers.get("location")).toBe("https://example.com/new");

  expect((await call(app, owner, "POST", `/api/links/${link.id}/deactivate`)).body.active).toBe(false);
  expect((await app.request(`/${link.slug}`)).status).toBe(404);

  expect((await call(app, owner, "POST", `/api/links/${link.id}/reactivate`)).body.active).toBe(true);
  expect((await app.request(`/${link.slug}`)).status).toBe(302);
});

test("listing pages through Links newest first", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-paging@example.com")).cookie };
  const first = await createLink(owner, { defaultTarget: "https://example.com/paging/1" });
  const second = await createLink(owner, { defaultTarget: "https://example.com/paging/2" });

  expect((await call(app, owner, "GET", "/api/links?search=paging&limit=1")).body).toEqual({ links: [second], nextOffset: 1 });
  expect((await call(app, owner, "GET", "/api/links?search=paging&limit=1&offset=1")).body).toEqual({ links: [first], nextOffset: null });
});

test("custom slugs work on the instance domain, reserved slugs don't", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-custom-slugs@example.com")).cookie };
  const create = (body: object) => call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.com/sale", ...body });

  expect(await create({ slug: "Spring-Sale" })).toMatchObject({
    status: 201,
    body: { slug: "spring-sale", shortUrl: "http://localhost:3000/spring-sale" },
  });
  expect((await app.request("/spring-sale")).headers.get("location")).toBe("https://example.com/sale");
  expect(await create({ slug: "spring-sale" })).toMatchObject({ status: 409, body: { code: "SLUG_TAKEN" } });
  for (const slug of ["api", "app", "docs", "qr", "health", "healthz", "assets", "static", "OAuth"]) {
    expect(await create({ slug })).toMatchObject({ status: 400, body: { code: "SLUG_RESERVED" } });
  }
});

test("invalid fields are refused with clear errors", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-slugs@example.com")).cookie };
  const link = await createLink(owner, { defaultTarget: "https://example.com" });
  const create = (body: object) => call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.com", ...body });

  expect(await create({ defaultTarget: "javascript:alert(1)" })).toEqual({
    status: 400,
    body: { code: "INVALID_REQUEST", message: "defaultTarget: Enter an absolute http or https URL, like https://example.com/page." },
  });
  expect((await create({ title: "x".repeat(201) })).body.message).toBe("title: Keep the title under 200 characters.");
  expect((await call(app, owner, "GET", `/api/links/${link.slug}`)).body.message).toBe(
    "id: Use the link's id from createLink or listLinks, not its slug.",
  );
});

test("the OpenAPI spec is served under /api with each operation's Scope", async () => {
  const response = await app.request("/api/openapi.json");
  expect(response.status).toBe(200);
  const spec = await response.json();
  expect(spec.paths["/api/links"].post.security).toEqual([{ bearer: ["links:write"] }]);
  expect(spec.paths["/api/links/{id}"].get.security).toEqual([{ bearer: ["links:read"] }]);
});

test("an admin deletes a deactivated link with its clicks, which frees its slug; nobody else can", async () => {
  const admin = { cookie: (await verifiedUser(app, "admin-delete@example.com")).cookie };
  const member = await verifiedUser(app, "member-delete@example.com");
  expect((await call(app, admin, "PATCH", `/api/users/${member.userId}`, { role: "member" })).status).toBe(200);
  const { body: apiKey } = await call(app, admin, "POST", "/api/api-keys", {
    name: "Agent",
    scopes: ["links:read", "links:write", "instance:admin"],
  });
  const link = await createLink(admin, { defaultTarget: "https://example.com/old", slug: "summer-flyer" });
  await createPartitions(db, [new Date()]);
  await db.insert(clicks).values({
    id: "deleted-link",
    clickedAt: new Date(),
    linkId: link.id,
    slug: link.slug,
    deviceType: "desktop",
    query: {},
    bot: false,
    visitorHash: "visitor",
  });
  const remove = (headers: Record<string, string>) => call(app, headers, "DELETE", `/api/links/${link.id}`);

  expect((await remove(admin)).body.code).toBe("LINK_ACTIVE");
  await call(app, admin, "POST", `/api/links/${link.id}/deactivate`);
  expect((await remove({ cookie: member.cookie })).status).toBe(403);
  expect((await remove({ authorization: `Bearer ${apiKey.key}` })).status).toBe(401);

  expect((await remove(admin)).status).toBe(204);
  expect(await db.select().from(clicks).where(eq(clicks.linkId, link.id))).toEqual([]);
  await createLink(admin, { defaultTarget: "https://example.com/new", slug: "summer-flyer" });
});
