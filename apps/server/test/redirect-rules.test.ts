import { afterAll, expect, test } from "vitest";
import { createApp } from "../src/app.ts";
import { call, testEnv, verifiedUser } from "./client.ts";

const germanIp = "203.0.113.7";
const { app, close } = await createApp(await testEnv(), { lookupLocation: (ip) => (ip === germanIp ? { country: "DE" } : {}) });
afterAll(close);

const userAgents = {
  iPhone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  iPad: "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  safariOnMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  chromeOnMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  android: "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36",
  linux: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  windows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

async function createLink(headers: Record<string, string>, body: object) {
  const { status, body: link } = await call(app, headers, "POST", "/api/links", body);
  expect(status).toBe(201);
  return link;
}

async function follow(path: string, headers: Record<string, string>) {
  return (await app.request(path, { headers })).headers.get("location");
}

test("device Conditions send iOS, iPadOS, Android and desktop visitors to their targets", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-devices@example.com")).cookie };
  const { slug } = await createLink(owner, {
    defaultTarget: "https://example.com/desktop",
    redirectRules: [
      { conditions: [{ type: "device", device: "ios" }], target: "https://example.com/ios" },
      { conditions: [{ type: "device", device: "android" }], target: "https://example.com/android" },
    ],
  });

  expect(await follow(`/${slug}`, { "user-agent": userAgents.iPhone })).toBe("https://example.com/ios");
  expect(await follow(`/${slug}`, { "user-agent": userAgents.iPad })).toBe("https://example.com/ios");
  expect(await follow(`/${slug}`, { "user-agent": userAgents.android })).toBe("https://example.com/android");
  expect(await follow(`/${slug}`, { "user-agent": userAgents.linux, "sec-ch-ua-platform": '"Android"' })).toBe(
    "https://example.com/android",
  );
  expect(await follow(`/${slug}`, { "user-agent": userAgents.windows })).toBe("https://example.com/desktop");
  expect(await follow(`/${slug}`, { "user-agent": userAgents.chromeOnMac })).toBe("https://example.com/desktop");

  const iPadAsMac = await app.request(`/${slug}`, { headers: { "user-agent": userAgents.safariOnMac } });
  expect(iPadAsMac.status).toBe(200);
  expect(iPadAsMac.headers.get("cache-control")).toBe("no-store");
  expect(await iPadAsMac.text()).toContain('href="https://example.com/desktop" data-touch="https://example.com/ios"');
});

test("a country Condition uses the client IP; all Conditions must match and the first matching rule wins", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-countries@example.com")).cookie };
  const link = await createLink(owner, {
    defaultTarget: "https://example.com/en",
    redirectRules: [
      {
        conditions: [
          { type: "device", device: "ios" },
          { type: "country", countries: ["de", "AT"] },
        ],
        target: "https://example.com/de-app",
      },
      { conditions: [{ type: "country", countries: ["DE"] }], target: "https://example.com/de" },
    ],
  });
  expect(link.redirectRules[0].conditions[1]).toEqual({ type: "country", countries: ["DE", "AT"] });

  const german = { "x-forwarded-for": `198.51.100.1, ${germanIp}` };
  expect(await follow(`/${link.slug}`, { ...german, "user-agent": userAgents.iPhone })).toBe("https://example.com/de-app");
  expect(await follow(`/${link.slug}`, { ...german, "user-agent": userAgents.windows })).toBe("https://example.com/de");
  expect(await follow(`/${link.slug}`, { "x-forwarded-for": `${germanIp}, 198.51.100.1`, "user-agent": userAgents.iPhone })).toBe(
    "https://example.com/en",
  );
});

test("the App Store Preset sends the Click's UTM values and the instance's provider token to both stores", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-app-store@example.com")).cookie };
  const settings = await call(app, owner, "PATCH", "/api/settings", { appStoreProviderToken: "123456" });
  expect(settings.body).toMatchObject({ appStoreProviderToken: "123456" });

  const preset = await call(app, owner, "POST", "/api/presets/app-store", {
    appStoreId: "284882215",
    googlePlayPackage: "com.example.app",
    defaultTarget: "https://example.com/app",
  });
  expect(preset.body).toEqual({
    defaultTarget: "https://example.com/app",
    redirectRules: [
      { conditions: [{ type: "device", device: "ios" }], target: "https://apps.apple.com/app/id284882215?pt=123456&mt=8" },
      {
        conditions: [{ type: "device", device: "android" }],
        target: "https://play.google.com/store/apps/details?id=com.example.app",
      },
    ],
  });
  const { slug } = await createLink(owner, preset.body);
  const path = `/${slug}?utm_source=flyer&utm_medium=print&utm_campaign=spring-fair&lang=de`;

  const appStore = new URL((await follow(path, { "user-agent": userAgents.iPhone }))!);
  expect(appStore.origin + appStore.pathname).toBe("https://apps.apple.com/app/id284882215");
  expect(Object.fromEntries(appStore.searchParams)).toMatchObject({ pt: "123456", mt: "8", ct: "spring-fair", lang: "de" });

  const googlePlay = new URL((await follow(path, { "user-agent": userAgents.android }))!);
  expect(googlePlay.searchParams.get("id")).toBe("com.example.app");
  expect(googlePlay.searchParams.get("referrer")).toBe("utm_source=flyer&utm_medium=print&utm_campaign=spring-fair");

  expect(await follow(path, { "user-agent": userAgents.windows })).toBe(
    "https://example.com/app?utm_source=flyer&utm_medium=print&utm_campaign=spring-fair&lang=de",
  );
});

test("the mobile vs desktop and country split Presets generate ordinary rules", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-presets@example.com")).cookie };
  const mobileDesktop = await call(app, owner, "POST", "/api/presets/mobile-desktop", {
    mobileTarget: "https://m.example.com/",
    desktopTarget: "https://example.com/",
  });
  const { slug } = await createLink(owner, mobileDesktop.body);
  expect(await follow(`/${slug}`, { "user-agent": userAgents.android })).toBe("https://m.example.com/");
  expect(await follow(`/${slug}`, { "user-agent": userAgents.windows })).toBe("https://example.com/");

  const countrySplit = await call(app, owner, "POST", "/api/presets/country-split", {
    countryTargets: { de: "https://example.com/de", AT: "https://example.com/de", FR: "https://example.com/fr" },
    defaultTarget: "https://example.com/",
  });
  expect(countrySplit.body).toEqual({
    defaultTarget: "https://example.com/",
    redirectRules: [
      { conditions: [{ type: "country", countries: ["DE", "AT"] }], target: "https://example.com/de" },
      { conditions: [{ type: "country", countries: ["FR"] }], target: "https://example.com/fr" },
    ],
  });
});

test("a viewer can't change Redirect Rules or settings", async () => {
  const owner = { cookie: (await verifiedUser(app, "owner-rules-viewer@example.com")).cookie };
  const link = await createLink(owner, { defaultTarget: "https://example.com" });
  await call(app, owner, "POST", "/api/users/invitations", { email: "rules-viewer@example.com", role: "viewer" });
  const viewer = { cookie: (await verifiedUser(app, "rules-viewer@example.com")).cookie };

  const rules = [{ conditions: [{ type: "device", device: "ios" }], target: "https://example.com/ios" }];
  expect((await call(app, viewer, "PATCH", `/api/links/${link.id}`, { redirectRules: rules })).status).toBe(403);
  expect((await call(app, viewer, "PATCH", "/api/settings", { appStoreProviderToken: "1" })).status).toBe(403);
  expect((await call(app, owner, "GET", `/api/links/${link.id}`)).body.redirectRules).toEqual([]);
});
