import { readFileSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

export type DocsGroup = "Use flitz" | "Run flitz";
export type DocsPage = { slug: string; group: DocsGroup; source: string; description: string };

const file = (path: string) => fileURLToPath(new URL(path, import.meta.url));
const serverDoc = (name: string) => file(`../server/docs/${name}`);

export const docsPages: DocsPage[] = [
  {
    slug: "getting-started",
    group: "Use flitz",
    source: file("./docs/getting-started.md"),
    description: "Create your account and your first link, and share its short URL.",
  },
  {
    slug: "links",
    group: "Use flitz",
    source: file("./docs/links.md"),
    description: "Send each visitor to the right target by device or country.",
  },
  {
    slug: "stats",
    group: "Use flitz",
    source: file("./docs/stats.md"),
    description: "What flitz counts, what it never stores and how to read the numbers.",
  },
  {
    slug: "domains",
    group: "Use flitz",
    source: file("./docs/domains.md"),
    description: "Serve short URLs on your own domain, with a fallback URL.",
  },
  {
    slug: "ai-agents",
    group: "Use flitz",
    source: file("./docs/ai-agents.md"),
    description: "Let Claude, ChatGPT or Cursor manage links over MCP.",
  },
  {
    slug: "self-hosting",
    group: "Run flitz",
    source: serverDoc("self-hosting.md"),
    description: "Start flitz with docker compose or the Helm chart, and every setting it reads.",
  },
  {
    slug: "api-quick-start",
    group: "Run flitz",
    source: serverDoc("getting-started.md"),
    description: "Create an API key, create a link and follow its short URL.",
  },
  {
    slug: "mcp-reference",
    group: "Run flitz",
    source: serverDoc("mcp.md"),
    description: "Connect MCP clients with OAuth or an API key, and call tools.",
  },
  {
    slug: "concepts",
    group: "Run flitz",
    source: serverDoc("concepts.md"),
    description: "Roles, links, redirect rules, domains, clicks and the words flitz uses for them.",
  },
];

const exampleUrl = "https://flitz.example.com";
const icon = (paths: string, extra = "") =>
  `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${paths}</svg>`;
const arrow = icon('<path d="M5 12h14" /><path d="m12 5 7 7-7 7" />');
const groups: Record<DocsGroup, { text: string; icon: string }> = {
  "Use flitz": {
    text: "For everyone who creates links and reads the stats.",
    icon: icon(
      '<path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" /><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />',
    ),
  },
  "Run flitz": {
    text: "For developers who host flitz and connect it to other tools.",
    icon: icon(
      '<rect width="20" height="8" x="2" y="2" rx="2" /><rect width="20" height="8" x="2" y="14" rx="2" /><path d="M6 6h.01" /><path d="M6 18h.01" />',
    ),
  },
};

const escape = (text: string) => text.replace(/[&<>"]/g, (char) => `&${{ "&": "amp", "<": "lt", ">": "gt", '"': "quot" }[char]};`);
const headingId = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N} -]/gu, "")
    .replaceAll(" ", "-");

type Rendered = { page: DocsPage; title: string; html: string; ids: Set<string>; links: { href: string; slug: string; hash: string }[] };

function render(page: DocsPage): Rendered {
  const rendered: Rendered = { page, title: "", html: "", ids: new Set(), links: [] };
  const marked = new Marked({
    walkTokens(token) {
      if (token.type !== "link") return;
      const match = /^(?:([\w-]+)\.(md|html))?(#[^#]*)?$/.exec(token.href);
      if (!match || (!match[1] && !match[3])) return;
      const [, name, extension, hash = ""] = match;
      const target = !name
        ? page
        : extension === "md"
          ? docsPages.find((other) => basename(other.source) === `${name}.md` && dirname(other.source) === dirname(page.source))
          : docsPages.find((other) => other.slug === name);
      if (!target) throw new Error(`${page.source}: link to an unknown page: ${token.href}`);
      rendered.links.push({ href: token.href, slug: target.slug, hash: hash.slice(1) });
      token.href = target === page ? hash : `${target.slug}.html${hash}`;
    },
    renderer: {
      heading({ tokens, depth, text }) {
        const id = headingId(text.replaceAll("`", ""));
        if (depth === 1 && !rendered.title) rendered.title = this.parser.parseInline(tokens, this.parser.textRenderer);
        rendered.ids.add(id);
        return `<h${depth} id="${id}">${this.parser.parseInline(tokens)}</h${depth}>\n`;
      },
    },
  });
  const markdown = readFileSync(page.source, "utf8").replaceAll("{{BASE_URL}}/docs/", "").replaceAll("{{BASE_URL}}", exampleUrl);
  rendered.html = (marked.parse(markdown) as string)
    .replaceAll("<table>", '<div class="table-wrap"><table>')
    .replaceAll("</table>", "</table></div>");
  if (!rendered.title) throw new Error(`${page.source}: no H1`);
  if (rendered.html.includes("{{")) throw new Error(`${page.source}: {{ left after rendering`);
  return rendered;
}

function renderAll() {
  const all = new Map(docsPages.map((page) => [page.slug, render(page)]));
  for (const { page, links } of all.values()) {
    for (const link of links) {
      if (link.hash && !all.get(link.slug)!.ids.has(link.hash)) throw new Error(`${page.source}: link to a missing heading: ${link.href}`);
    }
  }
  return all;
}

function head(title: string, description: string, path: string) {
  return `<title>${escape(title)} · flitz docs</title>
<meta name="description" content="${escape(description)}" />
<link rel="canonical" href="%SITE_URL%/docs/${path}" />
<meta property="og:url" content="%SITE_URL%/docs/${path}" />
<meta property="og:title" content="${escape(title)} · flitz docs" />
<meta property="og:description" content="${escape(description)}" />`;
}

const grouped = () =>
  Object.keys(groups)
    .map((group) => ({ group: group as DocsGroup, pages: docsPages.filter((page) => page.group === group) }))
    .filter(({ pages }) => pages.length);

function home(all: Map<string, Rendered>) {
  const cards = grouped().map(
    ({ group, pages }) => `<section class="docs-group" aria-labelledby="group-${headingId(group)}">
  <div class="docs-group-head">
    <span class="card-icon">${groups[group].icon}</span>
    <div>
      <h2 id="group-${headingId(group)}">${group}</h2>
      <p>${groups[group].text}</p>
    </div>
  </div>
  <ul>
    ${pages.map((page) => `<li><a href="${page.slug}.html"><span><span class="docs-row-title">${all.get(page.slug)!.title}</span><span class="docs-row-text">${escape(page.description)}</span></span>${arrow}</a></li>`).join("\n    ")}
  </ul>
</section>`,
  );
  return `<main id="main" class="container docs-home">
  <div class="docs-intro">
    <h1>Docs</h1>
    <p class="lead">Run flitz on your own servers, then manage links, redirect rules and stats in the web app, through the API or with your AI agent.</p>
  </div>
  <div class="docs-groups">
${cards.join("\n")}
  </div>
</main>`;
}

function article(all: Map<string, Rendered>, current: DocsPage) {
  const index = docsPages.indexOf(current);
  const pager = [
    { page: docsPages[index - 1], label: "Previous", className: "docs-prev" },
    { page: docsPages[index + 1], label: "Next", className: "docs-next" },
  ].flatMap(({ page, label, className }) =>
    page ? [`<a href="${page.slug}.html" class="${className}"><span>${label}</span>${all.get(page.slug)!.title}</a>`] : [],
  );
  const nav = grouped().map(
    ({ group, pages }) => `<p class="docs-nav-heading" id="nav-${headingId(group)}">${group}</p>
    <ul aria-labelledby="nav-${headingId(group)}">
      ${pages.map((page) => `<li><a href="${page.slug}.html"${page === current ? ' aria-current="page"' : ""}>${all.get(page.slug)!.title}</a></li>`).join("\n      ")}
    </ul>`,
  );
  return `<div class="container docs">
  <main id="main" class="docs-main">
    <article class="prose">
${all.get(current.slug)!.html}
    </article>
    <nav class="docs-pager" aria-label="Previous and next page">${pager.join("")}</nav>
  </main>
  <nav class="docs-nav" aria-label="Docs">
    <a href="./" class="docs-all">All docs</a>
    ${nav.join("\n    ")}
  </nav>
</div>`;
}

export function docsHtml(page: string): { head: string; body: string } {
  const all = renderAll();
  if (page === "index") {
    return {
      head: head("Docs", "How to run flitz and how to use it: links, redirect rules, stats, domains and AI agents.", ""),
      body: home(all),
    };
  }
  const current = docsPages.find((other) => other.slug === page);
  if (!current) throw new Error(`No docs page ${page}`);
  return { head: head(all.get(page)!.title, current.description, `${page}.html`), body: article(all, current) };
}
