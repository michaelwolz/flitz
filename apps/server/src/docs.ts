import { readdir, readFile } from "node:fs/promises";
import { Hono } from "hono";

export const docsDirectory = new URL("../docs/", import.meta.url);

export async function docs(baseUrl: string) {
  const origin = new URL(baseUrl).origin;
  const files = new Map<string, string>();
  for (const name of await readdir(docsDirectory)) {
    files.set(name, (await readFile(new URL(name, docsDirectory), "utf8")).replaceAll("{{BASE_URL}}", origin));
  }
  return new Hono()
    .get("/", (c) => c.redirect("/docs/llms.txt"))
    .get("/:file", (c) => {
      const name = c.req.param("file");
      const text = files.get(name);
      if (text === undefined) return c.notFound();
      return c.body(text, 200, { "content-type": `${name.endsWith(".md") ? "text/markdown" : "text/plain"}; charset=utf-8` });
    });
}
