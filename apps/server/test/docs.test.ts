import { readdir } from "node:fs/promises";
import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { docsDirectory } from "../src/docs.ts";
import { testEnv } from "./client.ts";

const env = await testEnv();
const { app, close } = await createApp(env);
afterAll(close);

const llmsTxt = async () => (await app.request("/docs/llms.txt")).text();
const linkedUrls = (text: string) => [...text.matchAll(/\]\(([^)#]+)/g)].map(([, url]) => url);

test("llms.txt links every doc and the OpenAPI spec, each served from the instance, and docs link each other relatively", async () => {
  const docFiles = (await readdir(docsDirectory)).filter((name) => name.endsWith(".md"));
  const urls = linkedUrls(await llmsTxt());

  expect(urls.toSorted()).toEqual(
    [`${env.BASE_URL}/api/openapi.json`, ...docFiles.map((name) => `${env.BASE_URL}/docs/${name}`)].toSorted(),
  );
  expect((await app.request("/docs")).headers.get("location")).toBe("/docs/llms.txt");
  expect((await app.request(`${env.BASE_URL}/api/openapi.json`)).status).toBe(200);
  for (const name of docFiles) {
    const response = await app.request(`${env.BASE_URL}/docs/${name}`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^text\/markdown/);
    const text = await response.text();
    expect(text).not.toContain("{{BASE_URL}}");
    for (const url of linkedUrls(text)) {
      const target = new URL(url, `${env.BASE_URL}/docs/${name}`).href;
      expect(target.startsWith(`${env.BASE_URL}/docs/`)).toBe(true);
      expect((await app.request(target)).status).toBe(200);
    }
  }
});

test("docs use glossary words, naming avoided ones only in the Concepts list of terms to avoid", async () => {
  const docFiles = (await readdir(docsDirectory)).filter((name) => name.endsWith(".md"));
  for (const name of ["llms.txt", ...docFiles]) {
    const text = await (await app.request(`/docs/${name}`)).text();
    expect(text.split("## Terms to avoid")[0]).not.toMatch(/\b(short codes?|visits?|short links?)\b/i);
  }
});
