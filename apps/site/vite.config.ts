import { readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { docsHtml, docsPages } from "./docs.ts";

const pages = ["index", "faq", "docs/index", ...docsPages.map((page) => `docs/${page.slug}`)];
const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const root = file("./");
const repo = "https://github.com/michaelwolz/flitz";
const urls = {
  SITE_URL: "https://michaelwolz.github.io/flitz",
  REPO_URL: repo,
  DOCS_URL: `${repo}/tree/main/apps/server/docs`,
  LICENSE_URL: "https://www.apache.org/licenses/LICENSE-2.0",
};

function rebase(path: string, page: string, dev: boolean) {
  const [, pathname, suffix] = /^([^#?]*)(.*)$/.exec(path)!;
  const target = resolve(root, pathname);
  if (dev && relative(root, target).startsWith("..")) return `/@fs${target}${suffix}`;
  const url = relative(dirname(page), target);
  return (url === "" ? "." : url.startsWith(".") ? url : `./${url}`) + (pathname.endsWith("/") ? "/" : "") + suffix;
}

export default defineConfig({
  base: "/flitz/",
  plugins: [
    {
      name: "partials",
      transformIndexHtml: {
        order: "pre",
        handler: (html, { filename, server }) => {
          const page = html.replace(/<!-- (head|header|footer) -->/g, (_, name) =>
            readFileSync(file(`./partials/${name}.html`), "utf8").replace(
              /(src|href)="(\.\.?\/[^"]*)"/g,
              (_, attribute, path) => `${attribute}="${rebase(path, filename, Boolean(server))}"`,
            ),
          );
          const docsPage = relative(file("./docs"), filename);
          if (docsPage.startsWith("..")) return page;
          const { head, body } = docsHtml(docsPage.replace(/\.html$/, ""));
          return page.replace("<!-- docs-head -->", head).replace("<!-- docs -->", body);
        },
      },
      configureServer(server) {
        server.watcher.add(docsPages.map((page) => page.source));
        server.watcher.on("change", (path) => path.endsWith(".md") && server.ws.send({ type: "full-reload" }));
      },
    },
  ],
  define: Object.fromEntries(Object.entries(urls).map(([key, url]) => [`import.meta.env.${key}`, JSON.stringify(url)])),
  build: { assetsInlineLimit: 0, rolldownOptions: { input: pages.map((page) => file(`./${page}.html`)) } },
});
