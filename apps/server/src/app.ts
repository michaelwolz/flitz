import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "@hono/node-server/serve-static";
import { OpenAPIHono } from "@hono/zod-openapi";
import { Hono, type MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { type ApiEnv, authorizer, handleApiError, sameOriginOnly, validationHook } from "./api.ts";
import { apiKeyRoutes } from "./api-keys.ts";
import { assertAuthSecret, consentPage, createAuth, createMailer } from "./auth.ts";
import { recordClick } from "./clicks.ts";
import { connectedAppRoutes } from "./connected-apps.ts";
import { consentRoutes } from "./consent.ts";
import { docs } from "./docs.ts";
import { domainRoutes } from "./domains.ts";
import { connectStores, lowercaseList, required, version, wholeNumber } from "./env.ts";
import { createLinkCache, type DomainEnv } from "./link-cache.ts";
import { linkDeletionRoutes } from "./link-deletion.ts";
import { linkRoutes, reservedSlugs, slugPattern } from "./links.ts";
import { mcpEndpoint } from "./mcp.ts";
import { errorPage, notFoundPage } from "./not-found-page.ts";
import { presetRoutes } from "./presets.ts";
import { qrCodeHandler, qrRoutes } from "./qr.ts";
import { rateLimits } from "./rate-limits.ts";
import { type LookupLocation, locationLookup, redirect, requestFacts, trustedClientIp } from "./redirect-rules.ts";
import { settingsRoutes } from "./settings.ts";
import { statsRoutes } from "./stats.ts";
import { userRoutes } from "./users.ts";

const webApp = fileURLToPath(new URL("../../web/dist", import.meta.url));

type Dependencies = {
  lookupLocation?: LookupLocation;
  fetchClientMetadata?: Parameters<typeof createAuth>[5];
};

export async function createApp(
  env: NodeJS.ProcessEnv,
  { lookupLocation = locationLookup(env.GEOIP_DATABASE), fetchClientMetadata }: Dependencies = {},
) {
  assertAuthSecret(env);
  const baseUrl = required(env, "BASE_URL");
  const instanceHostname = new URL(baseUrl).hostname;
  const { db, redis } = await connectStores(env);
  const linkCache = await createLinkCache(db, redis, instanceHostname);
  const limits = rateLimits(env, redis);
  const sendEmail = createMailer(env);
  const adminEmails = lowercaseList(env, "ADMIN_EMAILS");
  const auth = createAuth(db, env, limits.auth, sendEmail, adminEmails, fetchClientMetadata);

  const { access, authorize, sessionUser } = authorizer(db, auth, baseUrl);
  const routes = [
    ...linkRoutes(db, baseUrl, linkCache),
    ...domainRoutes(db, baseUrl, linkCache),
    ...apiKeyRoutes(db),
    ...qrRoutes(db, baseUrl),
    ...presetRoutes(db),
    ...settingsRoutes(db),
    ...statsRoutes(db, baseUrl),
  ];
  const api = new OpenAPIHono<ApiEnv>({ defaultHook: validationHook }).basePath("/api");
  api.onError(handleApiError);
  api.openapiRoutes(
    routes.map(({ scope, route, handler }) => ({
      route: { ...route, security: [{ bearer: [scope] }], middleware: authorize(scope) },
      handler,
    })),
  );
  api.openAPIRegistry.registerComponent("securitySchemes", "bearer", {
    type: "http",
    scheme: "bearer",
    description: "An API key. Signed-in sessions work too.",
  });
  api.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "flitz API", version },
    servers: [{ url: baseUrl }],
  });

  const app = new Hono<DomainEnv>();
  app.onError((error, c) => {
    if (/^\/api(\/|$)/.test(c.req.path)) return handleApiError(error, c);
    if (error instanceof HTTPException) return error.getResponse();
    console.error(error);
    return c.html(errorPage(), 500);
  });

  app.get("/healthz", (c) => c.text("ok"));
  app.get("/api/domains/known", async (c) => {
    const hostname = c.req.query("domain")?.toLowerCase() ?? "";
    return c.body(null, (await linkCache.resolveHost(hostname)) === undefined ? 404 : 200);
  });
  app.use(async (c, next) => {
    const domain = await linkCache.resolveHost(new URL(c.req.url).hostname);
    if (domain === undefined || (domain && /^\/(api|app|docs)(\/|$)/.test(c.req.path))) return c.notFound();
    c.set("domain", domain);
    await next();
  });
  app.use(trustedClientIp(wholeNumber(env, "TRUSTED_PROXIES", 0)));
  const sameOrigin = sameOriginOnly(new URL(baseUrl).origin);
  app.use(consentPage, sameOrigin);
  app.use("/api/*", (c, next) => (c.req.path.startsWith("/api/auth/") ? next() : sameOrigin(c, next)));
  const noFraming: MiddlewareHandler = (c, next) => {
    c.header("content-security-policy", "frame-ancestors 'none'");
    c.header("x-frame-options", "DENY");
    return next();
  };
  for (const path of [consentPage, "/app/*"]) app.use(path, noFraming);
  app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));
  app.get("/.well-known/*", (c) => auth.handler(c.req.raw));
  app.route(consentPage, consentRoutes(db, auth));
  app.get("/api/social-providers", (c) => c.json(Object.keys(auth.options.socialProviders)));
  app.all("/api/mcp", mcpEndpoint(routes, api.request, access, new URL("/.well-known/oauth-protected-resource/api/mcp", baseUrl).href));
  app.route("/api/connected-apps", connectedAppRoutes(db, sessionUser));
  app.route("/api/links", linkDeletionRoutes(db, sessionUser));
  app.route("/api/users", userRoutes(db, auth, baseUrl, adminEmails, sendEmail));
  app.route("/", api);
  app.route("/docs", await docs(baseUrl));
  app.get("/qr/:file{[a-zA-Z0-9-]+\\.(?:svg|png)}", limits.redirects, qrCodeHandler(baseUrl, linkCache));
  const cacheControl =
    (value: string): MiddlewareHandler =>
    (c, next) => {
      c.header("cache-control", value);
      return next();
    };
  app.get(
    "/app/assets/*",
    cacheControl("public, max-age=31536000, immutable"),
    serveStatic({ rewriteRequestPath: (path) => join(webApp, path.slice("/app".length)) }),
  );
  app.get("/app/*", cacheControl("no-cache"), serveStatic({ path: join(webApp, "index.html") }));
  app.get("/", (c) => (c.var.domain === null ? c.redirect("/app/sign-up") : c.notFound()));

  app.get("/:slug", limits.redirects, async (c) => {
    const slug = c.req.param("slug").toLowerCase();
    if (reservedSlugs.has(slug)) return c.notFound();
    const { domain } = c.var;
    const isSlug = slugPattern.test(slug);
    const link = isSlug ? await linkCache.resolve(domain?.id ?? null, slug) : null;
    if (isSlug) {
      const facts = requestFacts(c, lookupLocation);
      const shortUrl = { linkId: link?.id, domainId: domain?.id, slug };
      recordClick(redis, c, facts, shortUrl).catch((error) => console.error("Cannot record Click:", error));
      if (link) return redirect(c, link, facts);
    }
    if (domain?.fallbackUrl && !link) return c.redirect(domain.fallbackUrl, 302);
    return c.html(notFoundPage(`${new URL(c.req.url).host}/${c.req.param("slug")}`), 404);
  });

  return { app, close: () => Promise.all([linkCache.close(), redis.close(), db.$client.end()]) };
}
