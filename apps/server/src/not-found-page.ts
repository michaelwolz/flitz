import { html, raw } from "hono/html";
import type { HtmlEscapedString } from "hono/utils/html";

type Html = HtmlEscapedString | Promise<HtmlEscapedString>;

export const brandTokens = raw(`:root {
  --background: #FFFAF8; --foreground: #1F1235; --card: #FFFFFF; --muted: #F5F1F7; --muted-foreground: #675E7A; --border: #EDE6F0;
  --input: #958CA6; --primary: #FF6B5B; --primary-foreground: #2E1065; --secondary: #F1ECFA; --secondary-foreground: #2E1065;
  --accent: #FFEFEC; --accent-foreground: #2E1065; --ring: #6E4BD8; --destructive: #C0263F; --elevation-xs: 0 1px 2px #1F12350D;
  --font-heading: "Bricolage Grotesque Variable", "Bricolage Grotesque", ui-sans-serif, system-ui, sans-serif;
  --font-sans: "Figtree Variable", Figtree, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "DM Mono", ui-monospace, "SF Mono", Menlo, monospace;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --background: #140A26; --foreground: #F4EFFC; --card: #1D1135; --muted: #241739; --muted-foreground: #B3A8C9; --border: #2F2347;
    --input: #6E6387; --secondary: #2B1C4A; --secondary-foreground: #F4EFFC; --accent: #2E1C4C; --accent-foreground: #F4EFFC;
    --ring: #A78BFA; --destructive: #F2557A; --elevation-xs: 0 1px 2px #00000066;
  }
}`);

type LegalLinks = { imprint?: string; privacyPolicy?: string };

export function notFoundPage(shortUrl: string, legal: LegalLinks) {
  return publicPage(
    legal,
    "Short URL not found",
    "This short URL doesn't go anywhere",
    html`<p class="lead"><code translate="no">${shortUrl}</code> is not a link on this domain, or its link was deactivated.</p>
<p>Check the address for typos. Capital letters don't matter, every other character does. If you scanned it from print, ask whoever printed it for the current address.</p>`,
  );
}

export function errorPage(legal: LegalLinks) {
  return publicPage(
    legal,
    "Something went wrong",
    "Something went wrong",
    html`<p class="lead">flitz couldn't answer this request. Try again in a moment.</p>`,
  );
}

export function publicPage({ imprint, privacyPolicy }: LegalLinks, title: string, heading: string, body: Html) {
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style>
${brandTokens}
:root { --page-width: 560px; }
body {
  margin: 0; min-height: 100vh; box-sizing: border-box; padding: 32px 24px;
  display: flex; flex-direction: column; align-items: center;
  background: var(--background); color: var(--foreground); font: 14px/20px var(--font-sans);
}
main { flex: 1; width: 100%; max-width: var(--page-width); display: flex; flex-direction: column; justify-content: center; gap: 24px; padding: 64px 0; }
.bars { display: flex; flex-direction: column; gap: 10px; }
.bars span { display: block; height: 14px; border-radius: 9999px; background: var(--primary); }
.bars span:first-child { width: 72px; margin-left: 24px; }
.bars span:last-child { width: 104px; }
h1 {
  margin: 0; font: 800 48px/52px var(--font-heading);
  letter-spacing: -0.03em; text-wrap: balance;
}
p { margin: 0; color: var(--muted-foreground); }
.lead { font-size: 18px; line-height: 28px; }
code {
  font: 500 16px/28px var(--font-mono); color: var(--foreground);
  background: var(--muted); padding: 2px 8px; border-radius: 7.2px; overflow-wrap: anywhere;
}
footer {
  width: 100%; max-width: var(--page-width); padding-top: 16px; border-top: 1px solid var(--border);
  display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; font-size: 13px; line-height: 18px; color: var(--muted-foreground);
}
footer a { display: flex; align-items: center; gap: 8px; color: inherit; text-underline-offset: 3px; }
footer a:hover { text-decoration-thickness: 2px; }
footer span { display: flex; gap: 16px; }
</style>
</head>
<body>
<main>
<div class="bars" aria-hidden="true"><span></span><span></span></div>
<h1>${heading}</h1>
${body}
</main>
<footer>
<a href="https://github.com/michaelwolz/flitz"><svg width="16" height="16" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="16" fill="#FF6B5B"/><g transform="translate(2 -1)" fill="none" stroke="#2E1065" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="10" d="M29.3 54 35.7 24C37.1 17.4 43.6 12 50.3 12M26 32H44"/><path stroke-width="6" d="M11 23h10M8 41h11"/></g></svg>
Short URLs by flitz</a>
<span>${imprint ? html`<a href="${imprint}">Imprint</a>` : ""}${privacyPolicy ? html`<a href="${privacyPolicy}">Privacy policy</a>` : ""}</span>
</footer>
</body>
</html>`;
}
