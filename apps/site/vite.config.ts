import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const pages = ["index", "faq"];
const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const repo = "https://github.com/michaelwolz/flitz";
const urls = {
  SITE_URL: "https://michaelwolz.github.io/flitz",
  REPO_URL: repo,
  DOCS_URL: `${repo}/tree/main/apps/server/docs`,
  LICENSE_URL: "https://www.apache.org/licenses/LICENSE-2.0",
};

export default defineConfig({
  base: "/flitz/",
  plugins: [
    {
      name: "partials",
      transformIndexHtml: {
        order: "pre",
        handler: (html) =>
          html.replace(/<!-- (head|header|footer) -->/g, (_, name) => readFileSync(file(`./partials/${name}.html`), "utf8")),
      },
    },
  ],
  define: Object.fromEntries(Object.entries(urls).map(([key, url]) => [`import.meta.env.${key}`, JSON.stringify(url)])),
  build: { assetsInlineLimit: 0, rolldownOptions: { input: pages.map((page) => file(`./${page}.html`)) } },
});
