import jsqr from "jsqr";
import { PNG } from "pngjs";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { call, testEnv, verifiedUser } from "./client.ts";

const { app, close } = await createApp(await testEnv());
afterAll(close);

test("a Link's PNG QR code decodes to its Short URL, not its target", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-qr@example.com")).cookie };
  const { body: link } = await call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.com/spring" });
  const { key } = (await call(app, owner, "POST", "/api/api-keys", { name: "Print", scopes: ["links:read"] })).body;

  const response = await app.request(`/api/links/${link.id}/qr?format=png`, { headers: { authorization: `Bearer ${key}` } });
  expect(response.status).toBe(200);
  expect(response.headers.get("content-type")).toBe("image/png");
  const png = PNG.sync.read(Buffer.from(await response.arrayBuffer()));
  expect(jsqr.default(new Uint8ClampedArray(png.data), png.width, png.height)?.data).toBe(link.shortUrl);
});

test("a viewer gets the SVG QR code, and the Short URL's Domain serves both formats for active Links only", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-qr-viewer@example.com")).cookie };
  const { body: link } = await call(app, owner, "POST", "/api/links", { defaultTarget: "https://example.com" });
  await call(app, owner, "POST", "/api/users/invitations", { email: "viewer-qr@example.com", role: "viewer" });
  const viewer = { cookie: (await verifiedUser(app, "viewer-qr@example.com")).cookie };

  const svg = await app.request(`/api/links/${link.id}/qr`, { headers: viewer });
  expect(svg.status).toBe(200);
  expect(svg.headers.get("content-type")).toBe("image/svg+xml");
  expect(await svg.text()).toMatch(/^<svg /);

  expect((await app.request(`/qr/${link.slug}.svg`)).headers.get("content-type")).toBe("image/svg+xml");
  expect((await app.request(`/qr/${link.slug.toUpperCase()}.png`)).headers.get("content-type")).toBe("image/png");
  await call(app, owner, "POST", `/api/links/${link.id}/deactivate`);
  expect((await app.request(`/qr/${link.slug}.png`)).status).toBe(404);
});
