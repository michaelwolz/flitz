import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import type { Condition, Device, RedirectRule } from "@flitzlink/db";
import type { HttpBindings } from "@hono/node-server";
import type { Context, MiddlewareHandler } from "hono";
import { html } from "hono/html";
import { isbot } from "isbot";
import { type CityResponse, Reader } from "mmdb-lib";
import { UAParser } from "ua-parser-js";

type Location = { country?: string; region?: string };
export type LookupLocation = (ip: string) => Location;
export type RequestFacts = Location & {
  query: URLSearchParams;
  devices: Device[];
  couldBeIPad: boolean;
  deviceType: string;
  os?: string;
  browser?: string;
  bot: boolean;
};
type LinkTargets = { defaultTarget: string; redirectRules: RedirectRule[] };

const officeLinkChecker = /ms-office|microsoft (office|outlook)/i;

export function locationLookup(databasePath: string | undefined): LookupLocation {
  if (!databasePath) return () => ({});
  const reader = new Reader<CityResponse>(readFileSync(databasePath));
  return (ip) => {
    const address = ip.replace(/^::ffff:/, "");
    const location = isIP(address) ? reader.get(address) : null;
    return { country: location?.country?.iso_code, region: location?.subdivisions?.[0]?.iso_code };
  };
}

export const clientIpHeader = "x-flitz-client-ip";

export function trustedClientIp(trustedProxies: number): MiddlewareHandler {
  let warned = false;
  return async (c, next) => {
    const hops = c.req.header("x-forwarded-for")?.split(",") ?? [];
    if (hops.length > 0 && trustedProxies === 0 && !warned) {
      warned = true;
      console.warn(
        "Requests carry X-Forwarded-For, but TRUSTED_PROXIES is 0, so flitz ignores it. Set TRUSTED_PROXIES to the number of reverse proxies in front of flitz.",
      );
    }
    const ip =
      trustedProxies > 0 && hops.length > 0
        ? hops[Math.max(hops.length - trustedProxies, 0)].trim()
        : (c.env as HttpBindings | undefined)?.incoming.socket.remoteAddress;
    c.req.raw.headers.delete(clientIpHeader);
    if (ip) c.req.raw.headers.set(clientIpHeader, ip);
    await next();
  };
}

export function clientIp(c: Context) {
  return c.req.header(clientIpHeader);
}

export function requestFacts(c: Context, lookupLocation: LookupLocation): RequestFacts {
  const { ua, os, device, engine, browser } = UAParser(c.req.header("user-agent"));
  const osName = (c.req.header("sec-ch-ua-platform")?.replaceAll('"', "") || os.name)?.replace(/^Mac OS$/, "macOS");
  const appOs = osName === "iOS" ? "ios" : osName === "Android" ? "android" : undefined;
  const ip = clientIp(c);
  return {
    ...(ip ? lookupLocation(ip) : {}),
    query: new URL(c.req.url).searchParams,
    devices: appOs ? [appOs, "mobile"] : [device.type === "mobile" || device.type === "tablet" ? "mobile" : "desktop"],
    couldBeIPad: osName === "macOS" && engine.name === "WebKit",
    deviceType: device.type ?? "desktop",
    os: osName,
    browser: browser.name,
    bot: isbot(ua) || officeLinkChecker.test(ua),
  };
}

function chooseTarget(link: LinkTargets, facts: RequestFacts) {
  const matches = (condition: Condition) =>
    condition.type === "device"
      ? facts.devices.includes(condition.device)
      : facts.country !== undefined && condition.countries.includes(facts.country);
  return link.redirectRules.find((rule) => rule.conditions.every(matches))?.target ?? link.defaultTarget;
}

export function redirect(c: Context, link: LinkTargets, facts: RequestFacts) {
  const target = withQuery(chooseTarget(link, facts), facts.query);
  const iPadTarget = facts.couldBeIPad ? withQuery(chooseTarget(link, { ...facts, devices: ["ios", "mobile"] }), facts.query) : target;
  if (iPadTarget === target) return c.redirect(target, 302);
  c.header("cache-control", "no-store");
  return c.html(touchCheckPage(iPadTarget, target));
}

function withQuery(target: string, query: URLSearchParams) {
  if (query.size === 0) return target;
  const url = new URL(target);
  const own = new Set(url.searchParams.keys());
  for (const [key, value] of query) if (!own.has(key)) url.searchParams.append(key, value);
  const utm = new URLSearchParams([...query].filter(([key]) => key.startsWith("utm_")));
  if (url.hostname === "play.google.com" && utm.size > 0 && !own.has("referrer")) url.searchParams.set("referrer", utm.toString());
  const campaign = query.get("utm_campaign")?.slice(0, 30).trim();
  if (url.hostname === "apps.apple.com" && campaign && !own.has("ct")) url.searchParams.set("ct", campaign);
  return url.href;
}

function touchCheckPage(touchTarget: string, target: string) {
  return html`<!doctype html>
<meta charset="utf-8">
<meta name="robots" content="noindex">
<title>Redirecting…</title>
<noscript><meta http-equiv="refresh" content="0;url=${target}"></noscript>
<a id="target" href="${target}" data-touch="${touchTarget}">Continue</a>
<script>
  const link = document.getElementById("target");
  location.replace(navigator.maxTouchPoints > 1 ? link.dataset.touch : link.href);
</script>
`;
}
