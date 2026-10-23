import jsqr from "jsqr";
import { PNG } from "pngjs";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { call, testEnv, verifiedUser } from "./client.ts";

const { app, close } = await createApp(await testEnv());
afterAll(close);

async function addDomain(owner: Record<string, string>, hostname: string, fallbackUrl?: string) {
  const { status, body: domain } = await call(app, owner, "POST", "/api/domains", { hostname, fallbackUrl });
  expect(status).toBe(201);
  return domain;
}

test("a custom domain serves links right after it is added; unknown hosts get 404", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-domain@example.com")).cookie };
  expect((await app.request("http://go.example.org/healthz")).status).toBe(200);
  expect((await app.request("/api/domains/known?domain=go.example.org")).status).toBe(404);
  expect((await app.request("http://go.example.org/spring")).status).toBe(404);

  const domain = await addDomain(owner, "Go.Example.org");
  expect(domain).toEqual({ id: expect.any(String), hostname: "go.example.org", fallbackUrl: null, createdAt: expect.any(String) });
  expect(await call(app, owner, "POST", "/api/domains", { hostname: "go.example.org" })).toMatchObject({
    status: 409,
    body: { code: "DOMAIN_TAKEN" },
  });
  const link = await call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.org/fair", domain: "go.example.org" });
  expect(link.body).toMatchObject({ domain: "go.example.org", shortUrl: `https://go.example.org/${link.body.slug}` });

  const redirect = await app.request(`http://go.example.org/${link.body.slug.toUpperCase()}`);
  expect(redirect.status).toBe(302);
  expect(redirect.headers.get("location")).toBe("https://example.org/fair");
  expect((await app.request("/api/domains/known?domain=go.example.org")).status).toBe(200);
  expect((await app.request("http://server:3000/api/domains/known?domain=go.example.org")).status).toBe(200);
  expect((await app.request("http://go.example.org/api/domains")).status).toBe(404);
  expect((await app.request(`http://unknown.example.org/${link.body.slug}`)).status).toBe(404);
});

test("the same custom Slug works on two Domains, each redirecting by Host", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-two-domains@example.com")).cookie };
  await addDomain(owner, "a.example.net");
  await addDomain(owner, "b.example.net");
  const create = (domain: string, defaultTarget: string) =>
    call(app, owner, "POST", "/api/links", { defaultTarget, domain, slug: "Spring" });

  const a = await create("a.example.net", "https://example.net/a");
  expect(a).toMatchObject({ status: 201, body: { slug: "spring", shortUrl: "https://a.example.net/spring" } });
  expect((await create("b.example.net", "https://example.net/b")).status).toBe(201);
  expect(await create("a.example.net", "https://example.net/again")).toMatchObject({ status: 409, body: { code: "SLUG_TAKEN" } });
  expect(
    await call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.net", domain: "a.example.net", slug: "API" }),
  ).toEqual({
    status: 400,
    body: { code: "SLUG_RESERVED", message: 'The slug "api" is reserved. Choose another one.' },
  });
  expect(await create("c.example.net", "https://example.net/c")).toMatchObject({ status: 400, body: { code: "DOMAIN_NOT_FOUND" } });

  expect((await app.request("http://a.example.net/spring")).headers.get("location")).toBe("https://example.net/a");
  expect((await app.request("http://b.example.net/spring")).headers.get("location")).toBe("https://example.net/b");
  expect((await app.request("/spring")).status).toBe(404);
  expect((await app.request("http://a.example.net/")).status).toBe(404);
});

test("unknown and deactivated Slugs go to the Fallback URL, or to the not-found page without one", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-fallback@example.com")).cookie };
  const domain = await addDomain(owner, "fallback.example.com", "https://example.com/home");
  const { body: link } = await call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.com/x", domain: domain.hostname });
  await call(app, owner, "POST", `/api/links/${link.id}/deactivate`);

  for (const path of ["/nope234", `/${link.slug}`]) {
    const response = await app.request(`http://fallback.example.com${path}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/home");
  }

  expect((await call(app, owner, "PATCH", `/api/domains/${domain.id}`, { fallbackUrl: null })).body.fallbackUrl).toBeNull();
  const notFound = await app.request("http://fallback.example.com/%3Cb%3Enope");
  expect(notFound.status).toBe(404);
  const page = await notFound.text();
  expect(page).toContain("This short URL doesn&#39;t go anywhere");
  expect(page).toContain("fallback.example.com/&lt;b&gt;nope");
});

test("a Custom Domain's public QR code encodes the Short URL on that Domain", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-domain-qr@example.com")).cookie };
  await addDomain(owner, "qr.example.org");
  await call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.org/menu", domain: "qr.example.org", slug: "menu" });

  const response = await app.request("http://qr.example.org/qr/menu.png");
  expect(response.headers.get("content-type")).toBe("image/png");
  const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
  expect(jsqr.default(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe("https://qr.example.org/menu");
  expect((await app.request("/qr/menu.png")).status).toBe(404);
});

test("a Custom Domain with a Link on it can't be deleted, one without Links can", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-delete-domain@example.com")).cookie };
  const used = await addDomain(owner, "used.example.org");
  const { body: link } = await call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.org/x", domain: used.hostname });
  await call(app, owner, "POST", `/api/links/${link.id}/deactivate`);
  expect(await call(app, owner, "DELETE", `/api/domains/${used.id}`)).toMatchObject({ status: 409, body: { code: "DOMAIN_HAS_LINKS" } });

  const unused = await addDomain(owner, "typo.example.org");
  expect((await call(app, owner, "DELETE", `/api/domains/${unused.id}`)).status).toBe(204);
  expect((await call(app, owner, "DELETE", `/api/domains/${unused.id}`)).status).toBe(404);
  expect((await app.request("/api/domains/known?domain=typo.example.org")).status).toBe(404);
  const hostnames = (await call(app, owner, "GET", "/api/domains")).body.domains.map(({ hostname }: { hostname: string }) => hostname);
  expect(hostnames).toContain("used.example.org");
  expect(hostnames).not.toContain("typo.example.org");
});
