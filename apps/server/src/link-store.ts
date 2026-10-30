import { and, type Db, domains, eq, isNull, links } from "@flitzlink/db";

export type LinkStore = ReturnType<typeof createLinkStore>;
export type DomainEnv = { Variables: { domain: Exclude<Awaited<ReturnType<LinkStore["resolveHost"]>>, undefined> } };

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

export function createLinkStore(db: Db, instanceHostname: string) {
  return {
    resolve: (domainId: string | null, slug: string) => loadLink(db, domainId, slug),
    /** The Custom Domain on `hostname`, null for the Instance Domain, undefined for any other host. */
    resolveHost: (hostname: string) => (hostname === instanceHostname ? Promise.resolve(null) : loadDomain(db, hostname)),
  };
}
