import { type RouteConfig, z } from "@hono/zod-openapi";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import type { Context } from "hono";
import { HTTPException } from "hono/http-exception";
import { version } from "./env.ts";

type Dispatch = (url: URL, init: RequestInit) => Response | Promise<Response>;

const maxTextLength = 1_000_000;

export function mcpEndpoint(
  routes: readonly { route: RouteConfig & { operationId: string } }[],
  dispatch: Dispatch,
  authenticate: (headers: Headers) => Promise<unknown>,
  resourceMetadataUrl: string,
) {
  const tools = routes.map(({ route }) => {
    const params = shapeOf(route.request?.params);
    const query = shapeOf(route.request?.query);
    const media = route.request?.body?.content["application/json"];
    const body = media && "schema" in media ? shapeOf(media.schema) : undefined;
    const names = [params, query, body ?? {}].flatMap(Object.keys);
    const shared = names.find((name, index) => names.indexOf(name) !== index);
    if (shared) {
      throw new Error(`The MCP Tool ${route.operationId} takes ${shared} from more than one of path, query and body. Rename one of them.`);
    }
    return { route, query, body, inputSchema: z.strictObject({ ...params, ...query, ...body }) };
  });

  const handler = createMcpHandler(() => {
    const server = new McpServer({ name: "flitz", version });
    for (const { route, query, body, inputSchema } of tools) {
      server.registerTool(
        route.operationId,
        { title: route.summary, description: route.description ?? route.summary, inputSchema },
        async (args, ctx) => {
          const request = ctx.http!.req!;
          const path = route.path.replace(/{(\w+)}/g, (_, name) => encodeURIComponent(String(args[name])));
          const url = new URL(`/api${path}`, request.url);
          for (const name in query) for (const value of [args[name] ?? []].flat()) url.searchParams.append(name, String(value));
          const response = await dispatch(url, {
            method: route.method.toUpperCase(),
            headers: { authorization: request.headers.get("authorization") ?? "", ...(body && { "content-type": "application/json" }) },
            body: body && JSON.stringify(Object.fromEntries(Object.entries(args).filter(([name]) => Object.hasOwn(body, name)))),
          });
          const type = response.headers.get("content-type") ?? "";
          const content = /^image\/(?!svg)/.test(type)
            ? { type: "image" as const, data: Buffer.from(await response.arrayBuffer()).toString("base64"), mimeType: type }
            : { type: "text" as const, text: await cappedText(response) };
          return { content: [content], isError: !response.ok };
        },
      );
    }
    return server;
  });
  return async (c: Context) => {
    await authenticate(c.req.raw.headers).catch((error) => {
      if (error instanceof HTTPException && error.status === 401) {
        error.res?.headers.set("WWW-Authenticate", `Bearer resource_metadata="${resourceMetadataUrl}"`);
      }
      throw error;
    });
    return handler.fetch(c.req.raw);
  };
}

async function cappedText(response: Response) {
  if (!response.body) return "";
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let text = "";
  while (text.length <= maxTextLength) {
    const { done, value } = await reader.read();
    if (done) return text;
    text += value;
  }
  await reader.cancel();
  return `${text.slice(0, maxTextLength)}\n\n[flitz cut this result off after ${maxTextLength.toLocaleString("en")} characters. Ask for fewer days with from and to, or use getClickBreakdown or getClickTimeSeries for counts.]`;
}

function shapeOf(schema: unknown) {
  if (schema === undefined) return {};
  if (schema instanceof z.ZodObject) return schema.shape;
  throw new Error("MCP Tools need z.object schemas for path, query and JSON body");
}
