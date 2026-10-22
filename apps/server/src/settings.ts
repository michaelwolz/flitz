import { type Db, settings } from "@flitzlink/db";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRoute, jsonBody, jsonResponse } from "./api.ts";

const appStoreProviderToken = z
  .string()
  .regex(/^\d{1,20}$/, "Enter the numeric provider token from an App Store Connect campaign link, like 123456.")
  .nullable()
  .meta({
    description: "The `pt` of your App Store Connect campaign links. The App Store preset adds it to the App Store URLs it generates.",
  });

const timeZone = z
  .string()
  .max(64, "Use an IANA time zone name, like Europe/Berlin.")
  .refine(isTimeZone, "Use an IANA time zone name, like Europe/Berlin.")
  .meta({ description: "The IANA time zone stats are counted in, like Europe/Berlin. Days and hours of stats start in this zone." });

const monthsError = "Choose a whole number of months from 1 to 120.";
const retentionMonths = z
  .number({ error: monthsError })
  .int(monthsError)
  .min(1, monthsError)
  .max(120, monthsError)
  .meta({ description: "How many months clicks are kept before they are deleted, from 1 to 120." });

function isTimeZone(name: string) {
  if (!/^[a-z]/i.test(name)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: name }).resolvedOptions();
    return true;
  } catch {
    return false;
  }
}

const Settings = z.object({ timeZone, retentionMonths, appStoreProviderToken }).openapi("Settings");
export type Settings = z.infer<typeof Settings>;

const settingsColumns = {
  timeZone: settings.timeZone,
  retentionMonths: settings.retentionMonths,
  appStoreProviderToken: settings.appStoreProviderToken,
};

export async function readSettings(db: Db): Promise<Settings> {
  const [row] = await db.select(settingsColumns).from(settings);
  return row;
}

export function settingsRoutes(db: Db) {
  return [
    apiRoute({
      scope: "links:read",
      route: createRoute({
        method: "get",
        path: "/settings",
        operationId: "getSettings",
        summary: "Get instance settings",
        description: "Returns the instance's time zone, retention period and App Store provider token.",
        responses: { 200: jsonResponse("The instance's settings", Settings) },
      }),
      handler: async (c) => c.json(await readSettings(db), 200),
    }),
    apiRoute({
      scope: "instance:admin",
      route: createRoute({
        method: "patch",
        path: "/settings",
        operationId: "updateSettings",
        summary: "Update instance settings",
        description: "Changes the settings you send and keeps the others.",
        request: {
          body: jsonBody(
            z
              .strictObject({ timeZone, retentionMonths, appStoreProviderToken })
              .partial()
              .refine((fields) => Object.keys(fields).length > 0, "Send at least one setting."),
          ),
        },
        responses: { 200: jsonResponse("The updated settings", Settings) },
      }),
      handler: async (c) => {
        const [updated] = await db.update(settings).set(c.req.valid("json")).returning(settingsColumns);
        return c.json(updated, 200);
      },
    }),
  ];
}
