import { createHmac } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import { type Db, sql } from "@flitzlink/db";
import { positiveInteger, required } from "./env.ts";
import { clientIp } from "./redirect-rules.ts";

export type RateLimits = ReturnType<typeof rateLimits>;

export function rateLimits(env: NodeJS.ProcessEnv, db: Db) {
  const secret = required(env, "AUTH_SECRET");
  const redirectsPerMinute = positiveInteger(env, "RATE_LIMIT_REDIRECTS_PER_MINUTE", 600);

  async function withinLimit(key: string, max: number, seconds: number) {
    const [{ count }] = await db.execute<{ count: number }>(sql`
      insert into rate_limits (key, count, expires_at)
      values (${key}, 1, statement_timestamp() + make_interval(secs => ${seconds}))
      on conflict (key) do update set
        count = case when rate_limits.expires_at <= statement_timestamp() then 1 else least(rate_limits.count, ${max}) + 1 end,
        expires_at = case when rate_limits.expires_at <= statement_timestamp()
          then excluded.expires_at else rate_limits.expires_at end
      returning count
    `);
    return count <= max;
  }

  const hmac = (value: string) => createHmac("sha256", secret).update(value).digest("base64url");

  const auth = {
    async consume(key: string, { window, max }: { window: number; max: number }) {
      const allowed = await withinLimit(`ratelimit:auth:${hmac(key)}`, max, window);
      return { allowed, retryAfter: allowed ? null : window };
    },
  };

  const redirects: MiddlewareHandler = async (c, next) => {
    const ip = clientIp(c);
    if (ip && !(await withinLimit(`ratelimit:redirects:${hmac(ip)}`, redirectsPerMinute, 60))) {
      return c.text("Too many requests from your network. Wait a minute, then try again.", 429);
    }
    await next();
  };

  return { auth, redirects };
}
