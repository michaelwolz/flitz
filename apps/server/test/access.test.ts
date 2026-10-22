import { randomUUID } from "node:crypto";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { call, connectApp, lastEmailTo, newClient, testEnv, verifiedUser } from "./client.ts";

const agent = {
  client_id: "https://agent.example.com/oauth/client.json",
  client_name: "Agent",
  redirect_uris: ["https://agent.example.com/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};
const { app, close } = await createApp(await testEnv(), { fetchClientMetadata: async () => Response.json(agent) });
afterAll(close);

function post(path: string, body: object, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...newClient(), ...headers },
    body: JSON.stringify(body),
  });
}

async function createKey(cookie: string) {
  return (await (await post("/api/api-keys", { name: "Sync", scopes: ["links:read", "links:write"] }, { cookie })).json()).key as string;
}

async function listLinks(token: string) {
  return (await app.request("/api/links", { headers: { authorization: `Bearer ${token}` } })).status;
}

test("an API key stops working once its creator is removed or demoted below its scopes", async () => {
  const admin = await verifiedUser(app, "admin-access@example.com");
  const leaver = await verifiedUser(app, "leaver-access@example.com");
  const demoted = await verifiedUser(app, "demoted-access@example.com");
  const [adminKey, leaverKey, demotedKey] = await Promise.all([admin, leaver, demoted].map(({ cookie }) => createKey(cookie)));

  const { apiKeys } = await (await app.request("/api/api-keys", { headers: { cookie: admin.cookie } })).json();
  expect(apiKeys.map(({ createdBy }: { createdBy: string }) => createdBy).toSorted()).toEqual([
    "admin-access",
    "demoted-access",
    "leaver-access",
  ]);
  expect(await listLinks(leaverKey)).toBe(200);

  expect((await call(app, { cookie: admin.cookie }, "DELETE", `/api/users/${leaver.userId}`)).status).toBe(204);
  expect(await listLinks(leaverKey)).toBe(401);
  expect(await listLinks(adminKey)).toBe(200);

  const setRole = (role: string) => call(app, { cookie: admin.cookie }, "PATCH", `/api/users/${demoted.userId}`, { role });
  expect((await setRole("member")).status).toBe(200);
  expect(await listLinks(demotedKey)).toBe(200);
  expect((await setRole("viewer")).status).toBe(200);
  expect(await listLinks(demotedKey)).toBe(403);
});

test("a connected app loses access when its user resets the password", async () => {
  const email = "oauth-access@example.com";
  await verifiedUser(app, email);
  const beforeReset = (await connectApp(app, agent, { email, scope: "links:read" })).token.access_token;
  expect(await listLinks(beforeReset)).toBe(200);

  await post("/api/auth/request-password-reset", { email });
  const token = lastEmailTo(email, "Reset")?.match(/token=(\S+)/)?.[1];
  expect((await post("/api/auth/reset-password", { token, newPassword: "a brand new passphrase" })).status).toBe(200);
  expect(await listLinks(beforeReset)).toBe(401);
});

test("a signed-in request from another site is refused; the same origin, API Keys and non-browser clients pass", async () => {
  const { cookie } = await verifiedUser(app, "csrf-access@example.com");
  const createLink = (headers: Record<string, string>) => post("/api/links", { defaultTarget: "https://example.com/csrf" }, headers);

  expect((await createLink({ cookie, origin: "https://evil.example" })).status).toBe(403);
  expect((await createLink({ cookie, "sec-fetch-site": "cross-site" })).status).toBe(403);
  const consent = await app.request("/oauth/consent", {
    method: "POST",
    headers: { cookie, origin: "https://evil.example", "content-type": "application/x-www-form-urlencoded" },
    body: "decision=allow",
  });
  expect(consent.status).toBe(403);
  const disconnect = await app.request(`/api/connected-apps/${randomUUID()}`, {
    method: "DELETE",
    headers: { cookie, "sec-fetch-site": "same-site" },
  });
  expect(disconnect.status).toBe(403);

  expect((await createLink({ cookie, origin: "http://localhost:3000", "sec-fetch-site": "same-origin" })).status).toBe(201);
  expect((await createLink({ cookie })).status).toBe(201);
  const key = await createKey(cookie);
  expect((await createLink({ authorization: `Bearer ${key}`, origin: "https://evil.example" })).status).toBe(201);
});

test("the consent page and the web app refuse to be framed", async () => {
  for (const path of ["/oauth/consent", "/app/"]) {
    const response = await app.request(path);
    expect(response.headers.get("content-security-policy")).toBe("frame-ancestors 'none'");
    expect(response.headers.get("x-frame-options")).toBe("DENY");
  }
});
