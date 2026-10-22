import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { createAuthClient } from "better-auth/client";
import { inferAdditionalFields, magicLinkClient } from "better-auth/client/plugins";
import { t } from "i18next";
import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import type { ApiKey } from "../../../server/src/api-keys.ts";
import type { Domain } from "../../../server/src/domains.ts";
import type { Condition, Link, RedirectRule } from "../../../server/src/links.ts";
import { type Role, roles, type Scope, scopes, scopesOf } from "../../../server/src/scopes.ts";
import type { Settings } from "../../../server/src/settings.ts";
import type { ClickBreakdown, ClickTimeSeries, OrphanClicks } from "../../../server/src/stats.ts";
import type { InvitationRow, UserRow } from "../../../server/src/users.ts";

export const authClient = createAuthClient({
  plugins: [magicLinkClient(), inferAdditionalFields({ user: { role: { type: "string", input: false } } }), oauthProviderClient()],
});

export type {
  ApiKey,
  ClickBreakdown,
  ClickTimeSeries,
  Condition,
  Domain,
  InvitationRow,
  Link,
  OrphanClicks,
  RedirectRule,
  Role,
  Scope,
  Settings,
  UserRow,
};
export { roles, scopes, scopesOf };
export type Device = Extract<Condition, { type: "device" }>["device"];
export const devices = ["ios", "android", "mobile", "desktop"] as const satisfies readonly Device[];

export function signInPath(url: string | URL = location.href) {
  const { pathname, search } = new URL(url);
  const next = `${pathname.slice(import.meta.env.BASE_URL.length - 1) || "/"}${search}`;
  return `/sign-in?${new URLSearchParams({ next })}`;
}

export function appUrl(path: string) {
  return `${import.meta.env.BASE_URL}${path.slice(1)}`;
}

export async function api<T>(path: string, body?: object, method = body ? "POST" : "GET", signal?: AbortSignal): Promise<T> {
  const response = await fetch(
    `/api${path}`,
    body ? { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal } : { method, signal },
  );
  if (response.status === 401) throw redirect(signInPath());
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message ?? t("errors.generic"));
  return data;
}

type AuthResult<T> = { data: T; error: { message?: string; code?: string } | null };

export async function auth<T>(call: AuthResult<T> | Promise<AuthResult<T>>, messages: Record<string, string> = {}) {
  const { data, error } = await call;
  if (error) throw new Error(messages[error.code ?? ""] || error.message || t("errors.generic"));
  return data;
}

export function useAction() {
  const navigate = useNavigate();
  const [state, setState] = useState<{ pending: boolean; error?: string }>({ pending: false });
  async function run(action: () => Promise<unknown>) {
    setState({ pending: true });
    try {
      await action();
      setState({ pending: false });
    } catch (error) {
      if (error instanceof Response) return navigate(error.headers.get("Location")!);
      setState({ pending: false, error: error instanceof Error ? error.message : t("errors.generic") });
    }
  }
  return { ...state, run };
}

export function safeNext(next: string | null) {
  return next && /^\/(?![/\\])/.test(next) ? next : "/";
}
