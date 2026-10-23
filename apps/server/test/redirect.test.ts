import { connectAndMigrate, links } from "@flitzlink/db";
import { afterAll, beforeAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { testEnv } from "./client.ts";

const env = await testEnv();
const { app, close } = await createApp(env);
afterAll(close);

beforeAll(async () => {
  const db = await connectAndMigrate(env.DATABASE_URL);
  await db.insert(links).values({
    slug: "abc2345",
    defaultTarget: "https://example.com/landing?utm_source=print&lang=en",
  });
  await db.$client.end();
});

test("a Short URL redirects with 302 to its Default Target", async () => {
  const response = await app.request("/abc2345");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://example.com/landing?utm_source=print&lang=en");
});

test("query parameters of the Short URL are added to the target, but never override the target's own", async () => {
  const response = await app.request("/abc2345?utm_source=newsletter&ref=a");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://example.com/landing?utm_source=print&lang=en&ref=a");
});

test("an upper-case Slug finds the Link", async () => {
  const response = await app.request("/ABC2345");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://example.com/landing?utm_source=print&lang=en");
});

test("the root of the Instance Domain redirects to the sign-up page", async () => {
  const response = await app.request("/");
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("/app/sign-up");
});

test("an unknown Slug answers 404", async () => {
  const response = await app.request("/nope234");
  expect(response.status).toBe(404);
});

test("/healthz answers 200 for probes although healthz is a reserved Slug", async () => {
  expect((await app.request("/healthz")).status).toBe(200);
});
