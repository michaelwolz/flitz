import type { Db, Device, RedirectRule } from "@flitzlink/db";
import { createRoute, z } from "@hono/zod-openapi";
import { apiRoute, jsonBody, jsonResponse } from "./api.ts";
import { countryCode, httpUrl, RedirectRule as RedirectRuleSchema } from "./links.ts";
import { readSettings } from "./settings.ts";

const Preset = z.object({ defaultTarget: z.string(), redirectRules: z.array(RedirectRuleSchema) }).openapi("Preset", {
  description:
    "Ordinary redirect rules, not saved anywhere: pass `defaultTarget` and `redirectRules` to `createLink`, or to `updateLink`, where `redirectRules` replaces all of the link's rules.",
});

const savesNothing =
  "Saves nothing: pass the result's `defaultTarget` and `redirectRules` to `createLink`, or to `updateLink`, where they replace the link's default target and all of its redirect rules.";

const deviceRule = (device: Device, target: string): RedirectRule => ({
  conditions: [{ type: "device", device }],
  target,
});

export function presetRoutes(db: Db) {
  return [
    apiRoute({
      scope: "links:write",
      route: createRoute({
        method: "post",
        path: "/presets/app-store",
        operationId: "generateAppStorePreset",
        summary: "Generate App Store preset rules",
        description: `Generates redirect rules that send iOS to the App Store, Android to Google Play and everyone else to \`defaultTarget\`. The App Store URL carries the instance's App Store provider token. When a visitor follows the short URL, the short URL's \`utm_*\` parameters go into Google Play's \`referrer\` and \`utm_campaign\` into the App Store's \`ct\`. ${savesNothing}`,
        request: {
          body: jsonBody(
            z.strictObject({
              appStoreId: z
                .string()
                .regex(/^\d{1,20}$/, "Enter the numeric App Store ID, like 284882215.")
                .meta({ description: "The number in the app's App Store URL after `id`." }),
              googlePlayPackage: z
                .string()
                .regex(/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/, "Enter the app's package name, like com.example.app.")
                .meta({ description: "The id in the app's Google Play URL." }),
              defaultTarget: httpUrl.meta({ description: "Where everyone else goes, such as the app's website." }),
            }),
          ),
        },
        responses: { 200: jsonResponse("The generated rules", Preset) },
      }),
      handler: async (c) => {
        const { appStoreId, googlePlayPackage, defaultTarget } = c.req.valid("json");
        const { appStoreProviderToken } = await readSettings(db);
        const campaignParams = appStoreProviderToken ? `?pt=${appStoreProviderToken}&mt=8` : "";
        return c.json(
          {
            defaultTarget,
            redirectRules: [
              deviceRule("ios", `https://apps.apple.com/app/id${appStoreId}${campaignParams}`),
              deviceRule("android", `https://play.google.com/store/apps/details?id=${googlePlayPackage}`),
            ],
          },
          200,
        );
      },
    }),
    apiRoute({
      scope: "links:write",
      route: createRoute({
        method: "post",
        path: "/presets/mobile-desktop",
        operationId: "generateMobileDesktopPreset",
        summary: "Generate mobile vs desktop preset rules",
        description: `Generates a redirect rule that sends phones and tablets to \`mobileTarget\` and everyone else to \`desktopTarget\`. ${savesNothing}`,
        request: {
          body: jsonBody(
            z.strictObject({
              mobileTarget: httpUrl.meta({ description: "Where phones and tablets go, iOS and Android included." }),
              desktopTarget: httpUrl.meta({ description: "Where everyone else goes. It becomes the default target." }),
            }),
          ),
        },
        responses: { 200: jsonResponse("The generated rules", Preset) },
      }),
      handler: async (c) => {
        const { mobileTarget, desktopTarget } = c.req.valid("json");
        return c.json({ defaultTarget: desktopTarget, redirectRules: [deviceRule("mobile", mobileTarget)] }, 200);
      },
    }),
    apiRoute({
      scope: "links:write",
      route: createRoute({
        method: "post",
        path: "/presets/country-split",
        operationId: "generateCountrySplitPreset",
        summary: "Generate country split preset rules",
        description: `Generates one redirect rule per target, sending visitors from its countries there, and everyone else to \`defaultTarget\`. ${savesNothing}`,
        request: {
          body: jsonBody(
            z.strictObject({
              countryTargets: z.record(countryCode, httpUrl).meta({
                description: "The target per two-letter country code. Countries with the same target share one rule.",
                example: { DE: "https://example.com/de", AT: "https://example.com/de" },
              }),
              defaultTarget: httpUrl.meta({ description: "Where visitors from other countries, or of unknown country, go." }),
            }),
          ),
        },
        responses: { 200: jsonResponse("The generated rules", Preset) },
      }),
      handler: async (c) => {
        const { countryTargets, defaultTarget } = c.req.valid("json");
        const byTarget = Map.groupBy(Object.entries(countryTargets), ([, target]) => target);
        const redirectRules = [...byTarget].map(([target, entries]): RedirectRule => ({
          conditions: [{ type: "country", countries: entries.map(([country]) => country) }],
          target,
        }));
        return c.json({ defaultTarget, redirectRules }, 200);
      },
    }),
  ];
}
