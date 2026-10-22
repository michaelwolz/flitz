import { createHmac } from "node:crypto";
import type { MiddlewareHandler } from "hono";
import type { RedisClientType } from "redis";
import { positiveInteger, required } from "./env.ts";
import { clientIp } from "./redirect-rules.ts";

export type RateLimits = ReturnType<typeof rateLimits>;

export function rateLimits(env: NodeJS.ProcessEnv, redis: RedisClientType) {
  const secret = required(env, "AUTH_SECRET");
  const redirectsPerMinute = positiveInteger(env, "RATE_LIMIT_REDIRECTS_PER_MINUTE", 600);

  async function withinLimit(key: string, max: number, seconds: number) {
    const [count] = await redis.multi().incr(key).expire(key, seconds, "NX").exec();
    return Number(count) <= max;
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
