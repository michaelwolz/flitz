import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { connectDb, sql } from "@flitzlink/db";
import { expect, inject, vi } from "vitest";
import type { createApp } from "../src/app.ts";

export type App = Awaited<ReturnType<typeof createApp>>["app"];

export const password = "correct horse battery";

export const newClient = () => ({ "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}` });

/** A fresh database, with sign-up open to example.com as admin. */
export async function testEnv(overrides: Record<string, string | undefined> = {}) {
  const env = inject("env");
  const name = `test_${randomUUID().replaceAll("-", "")}`;
  const server = await connectDb(env.DATABASE_URL);
  await server.execute(sql.raw(`create database ${name}`));
  await server.$client.end();
  const databaseUrl = new URL(env.DATABASE_URL);
  databaseUrl.pathname = `/${name}`;
  const db = await connectDb(databaseUrl.href);
  await db.$client.end();
  return {
    ...env,
    DATABASE_URL: databaseUrl.href,
    SIGNUP_DOMAINS: "example.com",
    DEFAULT_ROLE: "admin",
    ...overrides,
  };
}

const log = vi.spyOn(console, "log");

export function emailsTo(address: string, subject = "") {
  return log.mock.calls.map(([line]) => String(line)).filter((line) => line.startsWith(`Email to ${address}: ${subject}`));
}

export const lastEmailTo = (address: string, subject = "") => emailsTo(address, subject).at(-1);

export function openEmailLink(app: App, address: string, subject: string) {
  return app.request(lastEmailTo(address, subject)?.match(/https?:\/\/\S+/)?.[0] ?? "");
}

export function cookieOf(response: Response) {
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export function signUp(app: App, email: string, { name = email.split("@")[0], origin = "" } = {}) {
  return app.request(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", ...newClient() },
    body: JSON.stringify({ name, email, password }),
  });
}

/** Signs up and opens the verification link, which signs the user in. */
export async function verifiedUser(app: App, email: string, options: { name?: string } = {}) {
  const response = await signUp(app, email, options);
  expect(response.status).toBe(200);
  const { user } = await response.json();
  const verified = await openEmailLink(app, email, "Verify");
  return { cookie: cookieOf(verified), userId: user.id as string };
}

export async function connectApp(
  app: App,
  agent: { client_id: string; redirect_uris: string[] },
  { email, scope, grant = scope.split(" "), state }: { email: string; scope: string; grant?: string[]; state?: string },
) {
  const resource = "http://localhost:3000/api/mcp";
  const verifier = randomBytes(32).toString("base64url");
  const authorization = new URLSearchParams({
    response_type: "code",
    client_id: agent.client_id,
    redirect_uri: agent.redirect_uris[0],
    scope,
    ...(state && { state }),
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
    resource,
  });
  const toSignIn = new URL((await app.request(`/api/auth/oauth2/authorize?${authorization}`)).headers.get("location") ?? "", "http://x");
  expect(toSignIn.pathname).toBe("/app/sign-in");
  const signIn = await app.request("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", ...newClient() },
    body: JSON.stringify({ email, password, oauth_query: toSignIn.search.slice(1) }),
  });
  const cookie = cookieOf(signIn);
  const consentUrl = (await signIn.json()).url as string;
  const consented = await app.request("/oauth/consent", {
    method: "POST",
    headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams([
      ["oauth_query", new URL(consentUrl, "http://x").search.slice(1)],
      ...grant.map((granted) => ["scope", granted]),
      ["decision", "allow"],
    ]),
  });
  const callback = new URL(consented.headers.get("location") ?? "");
  const tokenRequest = (body: Record<string, string>) =>
    app.request("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: agent.client_id, resource, ...body }),
    });
  const token = await (
    await tokenRequest({
      grant_type: "authorization_code",
      code: callback.searchParams.get("code") ?? "",
      redirect_uri: agent.redirect_uris[0],
      code_verifier: verifier,
    })
  ).json();
  return { cookie, consentUrl, callback, token, tokenRequest };
}

export async function call(app: App, headers: Record<string, string>, method: string, path: string, body?: object) {
  const response = await app.request(path, {
    method,
    headers: { ...headers, ...(body && { "content-type": "application/json" }) },
    body: body && JSON.stringify(body),
  });
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
}
