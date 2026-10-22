import { randomBytes } from "node:crypto";
import { apiKeys, type Db, desc, eq, users } from "@flitzlink/db";
import { createRoute, z } from "@hono/zod-openapi";
import { apiError, apiRoute, hashApiKey, jsonBody, jsonResponse } from "./api.ts";
import { type Scope, scopes } from "./scopes.ts";

const ApiKey = z
  .object({
    id: z.string(),
    name: z.string(),
    scopes: z.array(z.enum(scopes)),
    start: z.string().openapi({ description: "The first characters of the key, to recognise it." }),
    createdBy: z.string().openapi({
      description:
        "The name of the user who created the key. The key stops working when they are removed or their role no longer allows all of its scopes.",
    }),
    createdAt: z.string(),
  })
  .openapi("ApiKey");
export type ApiKey = z.infer<typeof ApiKey>;

function toJson({ apiKey, createdBy }: { apiKey: typeof apiKeys.$inferSelect; createdBy: string }) {
  return {
    id: apiKey.id,
    name: apiKey.name,
    scopes: apiKey.scopes as Scope[],
    start: apiKey.start,
    createdBy,
    createdAt: apiKey.createdAt.toISOString(),
  };
}

export function apiKeyRoutes(db: Db) {
  const withCreator = () =>
    db.select({ apiKey: apiKeys, createdBy: users.name }).from(apiKeys).innerJoin(users, eq(users.id, apiKeys.createdBy));

  return [
    apiRoute({
      scope: "instance:admin",
      route: createRoute({
        method: "post",
        path: "/api-keys",
        operationId: "createApiKey",
        summary: "Create an API key",
        description:
          "Creates an API key. The key is returned only in this response; store it now. Send it in the Authorization header: `Bearer flitz_...`.",
        request: {
          body: jsonBody(
            z.strictObject({
              name: z
                .string()
                .trim()
                .min(1, "Name the API key, such as after the script that uses it.")
                .max(100, "Keep the name under 100 characters.")
                .meta({ description: "A name to recognise the key by, such as the script or agent that uses it." }),
              scopes: z
                .array(z.enum(scopes))
                .min(1, "Choose at least one scope.")
                .meta({ description: "What the key may do. Choose only the scopes the software needs." }),
            }),
          ),
        },
        responses: { 201: jsonResponse("The new API key, including its secret", ApiKey.extend({ key: z.string() })) },
      }),
      handler: async (c) => {
        const key = `flitz_${randomBytes(32).toString("base64url")}`;
        const [{ id }] = await db
          .insert(apiKeys)
          .values({
            ...c.req.valid("json"),
            keyHash: hashApiKey(key),
            start: key.slice(0, 10),
            createdBy: c.var.userId,
          })
          .returning({ id: apiKeys.id });
        const [created] = await withCreator().where(eq(apiKeys.id, id));
        return c.json({ ...toJson(created), key }, 201);
      },
    }),
    apiRoute({
      scope: "instance:admin",
      route: createRoute({
        method: "get",
        path: "/api-keys",
        operationId: "listApiKeys",
        summary: "List API keys",
        description: "Lists the API keys, without their secrets.",
        responses: { 200: jsonResponse("The API keys", z.object({ apiKeys: z.array(ApiKey) })) },
      }),
      handler: async (c) => {
        const rows = await withCreator().orderBy(desc(apiKeys.createdAt));
        return c.json({ apiKeys: rows.map(toJson) }, 200);
      },
    }),
    apiRoute({
      scope: "instance:admin",
      route: createRoute({
        method: "delete",
        path: "/api-keys/{id}",
        operationId: "revokeApiKey",
        summary: "Revoke an API key",
        description: "Revokes an API key; requests with it are refused from now on.",
        request: {
          params: z.object({
            id: z
              .uuid({ error: "Use the API key's id from listApiKeys." })
              .meta({ description: "The API key's `id`, as `listApiKeys` returns it." }),
          }),
        },
        responses: { 204: { description: "The API key is revoked" } },
      }),
      handler: async (c) => {
        const [apiKey] = await db
          .delete(apiKeys)
          .where(eq(apiKeys.id, c.req.valid("param").id))
          .returning({ id: apiKeys.id });
        if (!apiKey) throw apiError(404, "NOT_FOUND", "This API key does not exist.");
        return c.body(null, 204);
      },
    }),
  ];
}
