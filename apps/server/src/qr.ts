import { readFile } from "node:fs/promises";
import { type Db, domains, eq, links } from "@flitzlink/db";
import { createRoute, z } from "@hono/zod-openapi";
import { initWasm, Resvg } from "@resvg/resvg-wasm";
import type { Handler } from "hono";
import { encode } from "uqr";
import { apiRoute } from "./api.ts";
import type { DomainEnv, LinkStore } from "./link-store.ts";
import { linkNotFound, linkParams, shortUrl } from "./links.ts";

const contentTypes = { svg: "image/svg+xml", png: "image/png" };
type Format = keyof typeof contentTypes;

const quietZone = 4;
const maxRenderedPngs = 100;
const renderedPngs = new Map<string, Uint8Array<ArrayBuffer>>();
const centreMark = await readFile(new URL("../../../docs/brand/flitz-qr-centre.svg", import.meta.url), "utf8");
await initWasm(readFile(new URL(import.meta.resolve("@resvg/resvg-wasm/index_bg.wasm"))));

function qrSvg(shortUrl: string) {
  const { size, data } = encode(shortUrl, { ecc: "H", border: quietZone });
  const modules = data.flatMap((row, y) => row.flatMap((dark, x) => (dark ? [`M${x} ${y}h1v1h-1z`] : []))).join("");
  const markSize = (size - 2 * quietZone) * 0.24;
  const markAt = (size - markSize) / 2;
  const mark = centreMark.replace("<svg ", `<svg x="${markAt}" y="${markAt}" width="${markSize}" height="${markSize}" `);
  return {
    size,
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code for ${shortUrl}"><rect width="${size}" height="${size}" fill="#FFFFFF"/><path d="${modules}"/>${mark}</svg>`,
  };
}

function renderPng(shortUrl: string) {
  const { size, svg } = qrSvg(shortUrl);
  const resvg = new Resvg(svg, { fitTo: { mode: "zoom", value: Math.ceil(1024 / size) } });
  const image = resvg.render();
  const png = image.asPng() as Uint8Array<ArrayBuffer>;
  image.free();
  resvg.free();
  return png;
}

function qrPng(shortUrl: string) {
  const png = renderedPngs.get(shortUrl) ?? renderPng(shortUrl);
  renderedPngs.delete(shortUrl);
  renderedPngs.set(shortUrl, png);
  if (renderedPngs.size > maxRenderedPngs) renderedPngs.delete(renderedPngs.keys().next().value!);
  return png;
}

function qrResponse(shortUrl: string, format: Format, cacheControl: string) {
  return new Response(format === "svg" ? qrSvg(shortUrl).svg : qrPng(shortUrl), {
    headers: { "content-type": contentTypes[format], "cache-control": cacheControl },
  });
}

export function qrRoutes(db: Db, baseUrl: string) {
  return [
    apiRoute({
      scope: "links:read",
      route: createRoute({
        method: "get",
        path: "/links/{id}/qr",
        operationId: "getLinkQrCode",
        summary: "Get a link's QR code",
        description:
          "Returns a QR code that encodes the link's short URL (never its target), as SVG or PNG, with the flitz mark in the centre.",
        request: {
          params: linkParams,
          query: z.object({ format: z.enum(["svg", "png"]).default("svg").meta({ description: "`svg` (the default) or `png`." }) }),
        },
        responses: {
          200: {
            description: "The QR code",
            content: {
              "image/svg+xml": { schema: z.string() },
              "image/png": { schema: z.string().openapi({ format: "binary" }) },
            },
          },
        },
      }),
      handler: async (c) => {
        const [link] = await db
          .select({ slug: links.slug, hostname: domains.hostname })
          .from(links)
          .leftJoin(domains, eq(links.domainId, domains.id))
          .where(eq(links.id, c.req.valid("param").id));
        if (!link) throw linkNotFound();
        return qrResponse(shortUrl(baseUrl, link.hostname, link.slug), c.req.valid("query").format, "private, max-age=86400");
      },
    }),
  ];
}

export function qrCodeHandler(baseUrl: string, linkStore: LinkStore): Handler<DomainEnv, "/qr/:file"> {
  return async (c) => {
    const [slug, format] = c.req.param("file").toLowerCase().split(".");
    const { domain } = c.var;
    const link = await linkStore.resolve(domain?.id ?? null, slug);
    if (!link) return c.notFound();
    return qrResponse(shortUrl(baseUrl, domain?.hostname ?? null, slug), format as Format, "public, max-age=86400");
  };
}
