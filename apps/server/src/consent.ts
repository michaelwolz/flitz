import { readFile } from "node:fs/promises";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { type Db, eq, oauthClients } from "@flitzlink/db";
import { type Context, Hono } from "hono";
import { html, raw } from "hono/html";
import type { Auth } from "./auth.ts";
import { brandTokens } from "./not-found-page.ts";
import { type Scope, scopes } from "./scopes.ts";

const lockup = raw(
  (await readFile(new URL("../../../docs/brand/flitz-lockup-light.svg", import.meta.url), "utf8"))
    .replace('fill="#2E1065"', 'fill="currentColor"')
    .replaceAll("Flitz", "flitz"),
);

const scopeDescriptions: Record<Scope, string> = {
  "links:read": "See links, their QR codes, the custom domains and the instance's settings.",
  "links:write": "Create, edit, deactivate and reactivate links, and generate presets.",
  "stats:read": "Read click stats and orphan clicks, and export clicks as CSV.",
  "domains:write": "Add, update and delete custom domains.",
  "instance:admin": "Manage API keys and instance settings.",
};
const checkedByDefault: readonly Scope[] = ["links:read", "links:write", "stats:read"];

type ConsentRequest = NonNullable<Awaited<ReturnType<ReturnType<typeof consentRequest>>>>;

function consentRequest(db: Db, auth: Auth) {
  return async (c: Context, oauthQuery: string) => {
    if (!(await verifyOAuthQueryParams(oauthQuery, (await auth.$context).secret))) return undefined;
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return undefined;
    const query = new URLSearchParams(oauthQuery);
    const clientId = query.get("client_id") ?? "";
    const [client] = await db.select({ name: oauthClients.name }).from(oauthClients).where(eq(oauthClients.clientId, clientId));
    if (!client) return undefined;
    const requested = query.get("scope")?.split(" ") ?? [];
    return {
      oauthQuery,
      email: session.user.email,
      client: { id: clientId, name: client.name ?? clientId },
      redirectHost: URL.parse(query.get("redirect_uri") ?? "")?.host ?? "",
      resource: query.get("resource") ?? "",
      requested,
      scopes: scopes.filter((scope) => requested.includes(scope)),
    };
  };
}

export function consentRoutes(db: Db, auth: Auth) {
  const load = consentRequest(db, auth);
  const expired = (c: Context) =>
    c.text("This connection request is no longer valid. Sign in to flitz and start connecting again from your AI app.", 400);

  return new Hono()
    .get("/", async (c) => {
      const request = await load(c, new URL(c.req.url).search.slice(1));
      return request ? c.html(consentPage(request)) : expired(c);
    })
    .post("/", async (c) => {
      const form = await c.req.parseBody({ all: true });
      const request = await load(c, String(form.oauth_query ?? ""));
      if (!request) return expired(c);
      const consent = (body: { accept: boolean; scope?: string }) =>
        auth.api.oauth2Consent({
          body: { ...body, oauth_query: request.oauthQuery },
          headers: c.req.raw.headers,
          request: c.req.raw,
          asResponse: false,
        });
      if (form.decision !== "allow") return c.redirect((await consent({ accept: false })).url);
      const chosen = request.scopes.filter((scope) => [form.scope].flat().includes(scope));
      if (!chosen.length) return c.html(consentPage(request, "Pick at least one thing the app can do."), 400);
      const granted = request.requested.includes("offline_access") ? [...chosen, "offline_access"] : chosen;
      const { url } = await consent({ accept: true, scope: granted.join(" ") });
      return c.redirect(url);
    });
}

function consentPage(request: ConsentRequest, error?: string) {
  const { client } = request;
  return html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Connect ${client.name} to flitz</title>
<style>
${brandTokens}
body {
  margin: 0; min-height: 100vh; box-sizing: border-box; padding: 32px 24px 48px;
  display: flex; flex-direction: column; align-items: center; gap: 32px;
  background: var(--background); color: var(--foreground); font: 14px/20px var(--font-sans);
}
header, main { width: 100%; max-width: 560px; }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; color: var(--muted-foreground); }
header svg { display: block; height: 28px; width: auto; color: var(--secondary-foreground); }
main, form { display: flex; flex-direction: column; gap: 24px; }
.intro, fieldset { display: flex; flex-direction: column; gap: 8px; }
.avatar {
  display: grid; place-items: center; width: 48px; height: 48px; border-radius: 12px;
  background: var(--secondary); color: var(--secondary-foreground); font: 700 22px/1 var(--font-heading);
}
h1 { margin: 8px 0 0; font: 700 36px/40px var(--font-heading); letter-spacing: -0.02em; text-wrap: balance; }
.lead { margin: 0; font-size: 18px; line-height: 28px; color: var(--muted-foreground); }
form { padding: 24px; background: var(--card); border: 1px solid var(--border); border-radius: 16.8px; }
dl { margin: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
dl div { display: flex; flex-direction: column; gap: 2px; }
dl div:first-child { grid-column: 1 / -1; }
dt { font-size: 13px; line-height: 18px; color: var(--muted-foreground); }
dd { margin: 0; font: 400 13px/20px var(--font-mono); overflow-wrap: anywhere; }
label, legend { font-weight: 500; }
fieldset { margin: 0; padding: 0; border: 0; }
legend { padding: 0; margin-bottom: 12px; }
.scope { display: flex; align-items: flex-start; gap: 10px; padding: 12px; border: 1px solid var(--border); border-radius: 12px; cursor: pointer; }
.scope input { width: 18px; height: 18px; margin: 1px 0 0; flex: none; accent-color: var(--ring); }
.scope span { display: flex; flex-direction: column; gap: 2px; }
.scope-id { font: 400 13px/18px var(--font-mono); color: var(--muted-foreground); }
.note {
  display: grid; grid-template-columns: 16px 1fr; gap: 2px 12px; padding: 12px 16px;
  border: 1px solid var(--border); border-radius: 12px; background: var(--card);
}
.note svg { margin-top: 2px; }
.note strong, .note p { grid-column: 2; margin: 0; }
.note strong { font-weight: 600; }
.note p { color: var(--muted-foreground); }
.error { margin: 0; color: var(--destructive); font-weight: 500; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; }
button {
  flex: 1 1 200px; height: 40px; padding: 0 24px; border: 1px solid transparent; border-radius: 9999px;
  font: 500 14px/20px var(--font-sans); cursor: pointer; box-shadow: var(--elevation-xs);
  transition: background-color 150ms cubic-bezier(0.23, 1, 0.32, 1), transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
}
button:active { transform: scale(.97); }
.allow { background: var(--primary); color: var(--primary-foreground); }
.allow:hover { background: color-mix(in oklab, var(--primary) 90%, var(--primary-foreground)); }
.cancel { background: var(--card); color: var(--foreground); border-color: var(--input); }
.cancel:hover { background: var(--accent); color: var(--accent-foreground); }
:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) { button:active { transform: none; } }
</style>
</head>
<body>
<header>
${lockup}
<span>Signed in as ${request.email}</span>
</header>
<main>
<div class="intro">
<span class="avatar" aria-hidden="true">${client.name.slice(0, 1).toUpperCase()}</span>
<h1>Connect ${client.name} to flitz</h1>
<p class="lead">${client.name} is asking to work with your links in flitz. It can only do what you allow here.</p>
</div>
<form method="post">
<input type="hidden" name="oauth_query" value="${request.oauthQuery}">
<dl>
<div><dt>Identified by</dt><dd translate="no">${client.id}</dd></div>
<div><dt>Sends you back to</dt><dd translate="no">${request.redirectHost}</dd></div>
<div><dt>Connects to</dt><dd translate="no">${request.resource}</dd></div>
</dl>
<fieldset>
<legend>What ${client.name} can do</legend>
${request.scopes.map(
  (scope) =>
    html`<label class="scope"><input type="checkbox" name="scope" value="${scope}"${checkedByDefault.includes(scope) ? html` checked` : ""}><span><span>${scopeDescriptions[scope]}</span><span class="scope-id" translate="no">${scope}</span></span></label>`,
)}
</fieldset>
<div class="note" role="note">
<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
<strong>Agents can deactivate links but never delete them.</strong>
<p>A deactivated link keeps its slug and clicks, and you can turn it back on.</p>
</div>
${error ? html`<p class="error" role="alert">${error}</p>` : ""}
<div class="actions">
<button type="submit" name="decision" value="allow" class="allow">Allow access</button>
<button type="submit" name="decision" value="cancel" class="cancel">Cancel</button>
</div>
</form>
</main>
</body>
</html>`;
}
