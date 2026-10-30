import { clicks, connectDb, links } from "@flitzlink/db";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { createPartitions } from "../src/clicks.ts";
import { connectApp, testEnv, verifiedUser } from "./client.ts";

const agent = {
  client_id: "https://agent.example.com/oauth/client.json",
  client_name: "Example <Agent>",
  redirect_uris: ["https://agent.example.com/callback"],
  token_endpoint_auth_method: "none",
  grant_types: ["authorization_code", "refresh_token"],
  response_types: ["code"],
};
const env = await testEnv();
const { app, close } = await createApp(env, { fetchClientMetadata: async () => Response.json(agent) });
const db = await connectDb(env.DATABASE_URL);
afterAll(() => Promise.all([close(), db.$client.end()]));

async function apiKey(email: string, scopes: string[]) {
  const { cookie } = await verifiedUser(app, email);
  const created = await app.request("/api/api-keys", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ name: "Agent", scopes }),
  });
  return (await created.json()).key as string;
}

async function connect(key: string) {
  const client = new Client({ name: "test-agent", version: "1.0.0" });
  await client.connect(
    new StreamableHTTPClientTransport(new URL("http://localhost:3000/api/mcp"), {
      fetch: async (url, init) => app.request(url, init),
      requestInit: { headers: { authorization: `Bearer ${key}` } },
    }),
  );
  return client;
}

async function callTool(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const [content] = result.content as { text: string }[];
  return { isError: result.isError ?? false, body: JSON.parse(content.text) };
}

test("an MCP client with an API Key lists the tools and creates a Link that redirects", async () => {
  const client = await connect(await apiKey("agent-mcp@example.com", ["links:read", "links:write"]));

  const { tools } = await client.listTools();
  expect(tools.find((tool) => tool.name === "createLink")).toMatchObject({
    description: expect.stringContaining("returns its short URL"),
    inputSchema: {
      properties: { defaultTarget: { type: "string" }, domain: { description: expect.stringContaining("custom domains") } },
      required: ["defaultTarget"],
    },
  });

  const created = await callTool(client, "createLink", { defaultTarget: "https://example.com/launch", title: "Launch" });
  expect(created).toMatchObject({
    isError: false,
    body: { title: "Launch", shortUrl: expect.stringMatching(/^http:\/\/localhost:3000\//) },
  });
  expect((await app.request(`/${created.body.slug}`)).headers.get("location")).toBe("https://example.com/launch");
  const qr = await client.callTool({ name: "getLinkQrCode", arguments: { id: created.body.id, format: "png" } });
  expect(qr.content).toEqual([{ type: "image", mimeType: "image/png", data: expect.any(String) }]);

  const listed = await callTool(client, "listLinks", { search: "launch", limit: 1 });
  expect(listed).toEqual({ isError: false, body: { links: [created.body], nextOffset: null } });
  const updated = await callTool(client, "updateLink", { id: created.body.id, title: "Launch day" });
  expect(updated.body.title).toBe("Launch day");
});

test("a tool call without the Scope returns an error", async () => {
  const reader = await connect(await apiKey("reader-mcp@example.com", ["links:read"]));

  const denied = await callTool(reader, "createLink", { defaultTarget: "https://example.com" });
  expect(denied).toMatchObject({ isError: true, body: { code: "FORBIDDEN", message: expect.stringContaining("links:write") } });
});

test("a tool result longer than 1 MB is cut off with a note on how to ask for less", async () => {
  const key = await apiKey("export-mcp@example.com", ["stats:read"]);
  const [link] = await db.insert(links).values({ slug: "mcp-export", defaultTarget: "https://example.com/" }).returning();
  const clickedAt = new Date();
  await createPartitions(db, [clickedAt]);
  await db.insert(clicks).values(
    Array.from({ length: 150 }, (_, i) => ({
      id: `mcp-export-${i}`,
      clickedAt,
      linkId: link.id,
      slug: link.slug,
      deviceType: "desktop",
      referrerDomain: "r".repeat(10_000),
      query: {},
      bot: false,
      visitorHash: "v",
    })),
  );
  const client = await connect(key);

  const result = await client.callTool({ name: "exportClicks", arguments: {} });
  const [{ text }] = result.content as { text: string }[];
  expect(text.length).toBeLessThan(1_001_000);
  expect(text).toMatch(/^clickedAt,shortUrl,/);
  expect(text).toContain("cut this result off after 1,000,000 characters");
  expect(text).toContain("getClickBreakdown");
});

test("a tool takes a list for a repeatable query parameter", async () => {
  const client = await connect(await apiKey("stats-mcp@example.com", ["stats:read"]));

  const breakdown = await callTool(client, "getClickBreakdown", { by: ["country", "link"] });
  expect(breakdown.isError).toBe(false);
  expect(Object.keys(breakdown.body.breakdowns)).toEqual(["country", "link"]);
});

test("every API operation has exactly one MCP Tool, with every input described", async () => {
  const spec = await (await app.request("/api/openapi.json")).json();
  const operationIds = Object.values<Record<string, { operationId: string }>>(spec.paths).flatMap((operations) =>
    Object.values(operations).map(({ operationId }) => operationId),
  );
  const client = await connect(await apiKey("parity-mcp@example.com", ["links:read"]));

  const { tools } = await client.listTools();
  expect(tools.map((tool) => tool.name).toSorted()).toEqual(operationIds.toSorted());
  const undescribed = tools.flatMap((tool) =>
    Object.entries(tool.inputSchema.properties ?? {})
      .filter(([, property]) => !(property as { description?: string }).description)
      .map(([name]) => `${tool.name}.${name}`),
  );
  expect(undescribed).toEqual([]);
});

test("MCP clients discover the protected resource and its authorization server", async () => {
  const resource = await (await app.request("/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(resource).toMatchObject({
    resource: "http://localhost:3000/api/mcp",
    authorization_servers: ["http://localhost:3000/api/auth"],
    scopes_supported: ["links:read", "links:write", "stats:read", "domains:write", "instance:admin"],
  });

  const server = await (await app.request("/.well-known/oauth-authorization-server/api/auth")).json();
  expect(server).toMatchObject({
    issuer: "http://localhost:3000/api/auth",
    authorization_endpoint: "http://localhost:3000/api/auth/oauth2/authorize",
    token_endpoint: "http://localhost:3000/api/auth/oauth2/token",
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
  });
  expect(server).not.toHaveProperty("registration_endpoint");
});

test("an MCP request without a valid credential gets a 401 pointing at the resource metadata", async () => {
  for (const authorization of ["", "Bearer not-a-token"]) {
    const response = await app.request("/api/mcp", {
      method: "POST",
      headers: { authorization, "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBe(
      'Bearer resource_metadata="http://localhost:3000/.well-known/oauth-protected-resource/api/mcp"',
    );
  }
});

test("a user connects an MCP client with some Scopes and the token stays within them", async () => {
  const email = "connect-mcp@example.com";
  await verifiedUser(app, email, { name: "Connect" });

  const { cookie, consentUrl, callback, token } = await connectApp(app, agent, {
    email,
    scope: "links:read links:write stats:read domains:write instance:admin",
    grant: ["links:read", "links:write"],
    state: "connect-1",
  });

  const page = await (await app.request(consentUrl, { headers: { cookie } })).text();
  expect(page).toContain("Connect Example &lt;Agent&gt; to flitz");
  expect(page).toContain("Agents can deactivate links but never delete them.");
  expect(`${callback.origin}${callback.pathname}`).toBe(agent.redirect_uris[0]);
  expect(callback.searchParams.get("state")).toBe("connect-1");
  expect(token).toMatchObject({ token_type: "Bearer", scope: "links:read links:write" });

  const client = await connect(token.access_token);
  const created = await callTool(client, "createLink", { defaultTarget: "https://example.com/connected" });
  expect(created.isError).toBe(false);
  expect(await callTool(client, "listApiKeys", {})).toMatchObject({
    isError: true,
    body: { code: "FORBIDDEN", message: expect.stringContaining("instance:admin") },
  });
  expect((await app.request(`/api/links/${created.body.id}`, { headers: { cookie } })).status).toBe(200);
});

test("disconnecting a connected app ends its access at once, including issued tokens", async () => {
  const email = "disconnect-mcp@example.com";
  await verifiedUser(app, email, { name: "Dana" });
  const { cookie, token, tokenRequest } = await connectApp(app, agent, { email, scope: "links:read offline_access" });
  const listLinks = () => app.request("/api/links", { headers: { authorization: `Bearer ${token.access_token}` } });
  expect((await listLinks()).status).toBe(200);

  const danasApps = async () =>
    (await (await app.request("/api/connected-apps", { headers: { cookie } })).json()).connectedApps.filter(
      ({ connectedBy }: { connectedBy: string }) => connectedBy === "Dana",
    );
  const connectedApps = await danasApps();
  expect(connectedApps).toEqual([
    {
      id: expect.any(String),
      clientId: agent.client_id,
      name: "Example <Agent>",
      scopes: ["links:read"],
      connectedBy: "Dana",
      connectedAt: expect.any(String),
      lastActiveAt: expect.any(String),
    },
  ]);

  const bypass = await app.request("/api/auth/oauth2/delete-consent", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ id: connectedApps[0].id }),
  });
  expect(bypass.status).toBe(404);

  const disconnected = await app.request(`/api/connected-apps/${connectedApps[0].id}`, { method: "DELETE", headers: { cookie } });
  expect(disconnected.status).toBe(204);
  expect((await listLinks()).status).toBe(401);
  const refreshed = await tokenRequest({ grant_type: "refresh_token", refresh_token: token.refresh_token });
  expect(await refreshed.json()).toMatchObject({ error: "invalid_grant" });
  expect(await danasApps()).toEqual([]);
});
