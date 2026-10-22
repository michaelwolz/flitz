import { and, type Db, domains, eq, isNull, links } from "@flitzlink/db";
import type { RedisClientType } from "redis";

type RedirectLink = NonNullable<Awaited<ReturnType<typeof loadLink>>>;
export type LinkCache = Awaited<ReturnType<typeof createLinkCache>>;
export type DomainEnv = { Variables: { domain: Exclude<Awaited<ReturnType<LinkCache["resolveHost"]>>, undefined> } };
type Entry<T> = { value: T; expires: number };

const linkChannel = "link:invalidated";
const hostChannel = "host:invalidated";
const localMaxEntries = 10_000;
const localTtlMs = 60_000;
const redisHitTtlSeconds = 60 * 60;
const redisMissTtlSeconds = 60;

async function loadLink(db: Db, domainId: string | null, slug: string) {
  const [link] = await db
    .select({
      id: links.id,
      defaultTarget: links.defaultTarget,
      redirectRules: links.redirectRules,
    })
    .from(links)
    .where(and(domainId ? eq(links.domainId, domainId) : isNull(links.domainId), eq(links.slug, slug), eq(links.active, true)));
  return link ?? null;
}

async function loadDomain(db: Db, hostname: string) {
  const [domain] = await db
    .select({ id: domains.id, hostname: domains.hostname, fallbackUrl: domains.fallbackUrl })
    .from(domains)
    .where(eq(domains.hostname, hostname));
  return domain;
}

const cacheKey = (domainId: string | null, slug: string) => `${domainId ?? "instance"}:${slug}`;

function recall<T>(cache: Map<string, Entry<T>>, key: string) {
  const entry = cache.get(key);
  if (!entry || entry.expires <= Date.now()) return undefined;
  cache.delete(key);
  cache.set(key, entry);
  return entry;
}

function remember<T>(cache: Map<string, Entry<T>>, key: string, value: T) {
  cache.delete(key);
  cache.set(key, { value, expires: Date.now() + localTtlMs });
  if (cache.size > localMaxEntries) cache.delete(cache.keys().next().value!);
  return value;
}

export async function createLinkCache(db: Db, redis: RedisClientType, instanceHostname: string) {
  const local = new Map<string, Entry<RedirectLink | null>>();
  const hosts = new Map<string, Entry<Awaited<ReturnType<typeof loadDomain>>>>();
  const subscriber = redis.duplicate().on("error", (error) => console.error("Redis subscriber error:", error));
  await subscriber.connect();
  await subscriber.subscribe(linkChannel, (key) => local.delete(key));
  await subscriber.subscribe(hostChannel, (hostname) => hosts.delete(hostname));

  function store(key: string, link: RedirectLink | null, condition?: "NX") {
    const ttl = link ? redisHitTtlSeconds : redisMissTtlSeconds;
    return redis.set(`link:${key}`, JSON.stringify(link), { expiration: { type: "EX", value: ttl }, condition });
  }

  return {
    async resolve(domainId: string | null, slug: string): Promise<RedirectLink | null> {
      const key = cacheKey(domainId, slug);
      const entry = recall(local, key);
      if (entry) return entry.value;
      const cached = await redis.get(`link:${key}`);
      if (cached !== null) return remember(local, key, JSON.parse(cached));
      const link = await loadLink(db, domainId, slug);
      await store(key, link, "NX");
      return remember(local, key, link);
    },

    async invalidate(domainId: string | null, slug: string) {
      const key = cacheKey(domainId, slug);
      await store(key, await loadLink(db, domainId, slug));
      await redis.publish(linkChannel, key);
      local.delete(key);
    },

    /** The Custom Domain on `hostname`, null for the Instance Domain, undefined for any other host. */
    async resolveHost(hostname: string) {
      if (hostname === instanceHostname) return null;
      const entry = recall(hosts, hostname);
      if (entry) return entry.value;
      return remember(hosts, hostname, await loadDomain(db, hostname));
    },

    async invalidateHost(hostname: string) {
      await redis.publish(hostChannel, hostname);
      hosts.delete(hostname);
    },

    close: () => subscriber.close(),
  };
}
