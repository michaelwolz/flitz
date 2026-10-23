import { randomInt } from "node:crypto";
import { type APIRequestContext, expect, type Page, test } from "@playwright/test";

test.use({ extraHTTPHeaders: async ({}, use) => use({ "x-forwarded-for": `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}` }) });

async function emailLink(request: APIRequestContext, to: string, subject: string) {
  const find = async () => {
    const emails: string[] = await (await request.get(`${process.env.FLITZ_URL}/e2e/emails`)).json();
    return emails.findLast((email) => email.startsWith(`Email to ${to}: ${subject}`))?.match(/https?:\/\/\S+/)?.[0] ?? "";
  };
  await expect.poll(find).not.toBe("");
  return find();
}

async function signUp(page: Page, name: string, invitation?: string) {
  const email = `${name.toLowerCase()}@example.com`;
  await page.goto(invitation ?? `${process.env.FLITZ_URL}/app/sign-up`);
  await page.getByLabel("Name").fill(name);
  if (!invitation) await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("status")).toHaveText(`Check your email to finish signing up. We sent a link to ${email}.`);
  await page.goto(await emailLink(page.request, email, "Verify"));
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
}

async function register(request: APIRequestContext, name: string) {
  const email = `${name.toLowerCase()}@example.com`;
  await request.post(`${process.env.FLITZ_URL}/api/auth/sign-up/email`, { data: { name, email, password: "correct horse battery" } });
  return email;
}

test("sign up, create a link with the App Store preset, find it in the links list and open its stats", async ({ page }) => {
  await signUp(page, "Ada");
  await expect(page.getByRole("heading", { name: "Create your first link" })).toBeVisible();
  await page.getByLabel("Default target").fill("https://example.com/app");
  await page.getByRole("button", { name: "Create link" }).click();

  await expect(page.getByRole("heading", { name: "Edit link" })).toBeVisible();
  await page.getByRole("button", { name: /^App Store/ }).click();
  await page.getByLabel("App Store ID").fill("1234567890");
  await page.getByLabel("Google Play package").fill("com.example.app");
  await page.getByRole("button", { name: "Apply preset" }).click();
  const rules = page.getByRole("list", { name: "Redirect rules, first match wins" });
  await expect(rules.getByRole("listitem")).toHaveCount(2);
  await expect(rules).toContainText("Device is iOS");
  await page.getByRole("button", { name: "Add redirect rule" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toHaveText("Rule 3, target: Enter an absolute http or https URL, like https://example.com/page.");
  await expect(page.getByRole("textbox", { name: "Target", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Remove rule" }).click();
  await page.getByLabel("Title").fill("App download");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Changes saved")).toBeVisible();

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Links" }).click();
  const row = page.getByRole("row", { name: /App download/ });
  await expect(row).toContainText("2 rules");
  await row.getByRole("button", { name: /^Copy short URL/ }).click();
  await expect(row.getByRole("status")).toHaveText("Short URL copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/^http:\/\/localhost:\d+\/[a-z0-9]{7}$/);

  await row.getByRole("link", { name: "Stats for App download" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "App download" })).toBeVisible();
  const chart = page.getByRole("figure", { name: "Clicks per day" });
  await expect(chart.getByRole("application", { name: /^Clicks and unique visitors per day/ })).toBeVisible();
  await expect(chart).toContainText("No clicks in this time range.");
});

test("create an API key, see it exactly once and find it in the list", async ({ page }) => {
  await signUp(page, "Grace");

  const nav = page.getByRole("navigation", { name: "Main" });
  await nav.getByRole("link", { name: "API keys" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Campaign sync");
  await page.getByRole("button", { name: "Create API key" }).click();
  await expect(page.getByLabel("New API key")).toHaveValue(/^flitz_/);
  const row = page.getByRole("row", { name: /Campaign sync/ });
  await expect(row).toContainText("links:write");

  await nav.getByRole("link", { name: "Users" }).click();
  await expect(page.getByRole("row", { name: /grace@example\.com/ })).toContainText("Admin · you");
  await nav.getByRole("link", { name: "API keys" }).click();
  await expect(row).toBeVisible();
  await expect(page.getByLabel("New API key")).toHaveCount(0);

  await nav.getByRole("link", { name: "Connect via MCP" }).click();
  await expect(page.getByRole("region", { name: "Connected apps" })).toContainText("No apps connected yet.");
});

test("an admin deletes a custom domain without links, but not one with a link", async ({ page }) => {
  const flitz = process.env.FLITZ_URL!;
  await signUp(page, "Hedy");
  for (const hostname of ["used.example.com", "typo.example.com"]) await page.request.post(`${flitz}/api/domains`, { data: { hostname } });
  await page.request.post(`${flitz}/api/links`, { data: { defaultTarget: "https://example.com/x", domain: "used.example.com" } });

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Domains" }).click();
  const deleteDomain = async (hostname: string) => {
    await page.getByRole("region", { name: hostname }).getByRole("button", { name: "Delete domain" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete domain" }).click();
  };
  await deleteDomain("used.example.com");
  await expect(page.getByRole("region", { name: "used.example.com" }).getByRole("alert")).toContainText("links are on it");

  await deleteDomain("typo.example.com");
  await expect(page.getByText("typo.example.com deleted")).toBeVisible();
  await expect(page.getByRole("region", { name: "typo.example.com" })).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1, name: "Domains" })).toBeFocused();
});

test("reset a forgotten password from the emailed link and sign in with the new one", async ({ page, request }) => {
  const flitz = process.env.FLITZ_URL!;
  await request.get(await emailLink(request, await register(request, "Linus"), "Verify"));

  await page.goto(`${flitz}/app/sign-in`);
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
  await page.getByLabel("Email").fill("linus@example.com");
  await page.getByRole("button", { name: "Email me a reset link" }).click();
  await expect(page.getByRole("status")).toContainText("If linus@example.com belongs to a flitz account");

  const resetUrl = await emailLink(request, "linus@example.com", "Reset");
  expect(resetUrl).toMatch(/\/app\/reset-password\?token=/);
  await page.goto(resetUrl);
  await page.getByLabel("New password").fill("a brand new passphrase");
  await page.getByRole("button", { name: "Set new password" }).click();
  await expect(page.getByRole("status")).toHaveText("Password changed. Sign in with your new password.");

  await page.getByRole("link", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("linus@example.com");
  await page.getByLabel("Password").fill("a brand new passphrase");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
});

test("signing in before verifying the email says a new verification link is on its way", async ({ page, request }) => {
  const email = await register(request, "Barbara");

  await page.goto(`${process.env.FLITZ_URL}/app/sign-in`);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Your email isn't verified yet. flitz sent you a new verification link: check your inbox and open it to sign in.",
  );
});

test("an admin invites a viewer, who sees links, the link editor and domains read-only", async ({ page }) => {
  const flitz = process.env.FLITZ_URL!;
  await signUp(page, "Olga");
  await page.request.post(`${flitz}/api/links`, { data: { defaultTarget: "https://example.com/sale", title: "Spring sale" } });

  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Users" }).click();
  await page.getByLabel("Email", { exact: true }).fill("vera@example.com");
  await page.getByLabel("Role", { exact: true }).selectOption("Viewer");
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Invitation sent to vera@example.com")).toBeVisible();
  await expect(page.getByRole("row", { name: /vera@example\.com/ })).toContainText("Viewer");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();

  await signUp(page, "Vera", await emailLink(page.request, "vera@example.com", "You're invited"));
  await expect(page.getByRole("row", { name: /Spring sale/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create link" })).toHaveCount(0);
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const name of ["Users", "Settings", "API keys"]) await expect(nav.getByRole("link", { name })).toHaveCount(0);

  await page.getByRole("link", { name: "Spring sale", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Edit link" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Default target" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Add redirect rule" })).toBeDisabled();
  await expect(page.getByRole("group", { name: "Start from a preset" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save changes" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Deactivate" })).toHaveCount(0);

  await nav.getByRole("link", { name: "Domains" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Domains" })).toBeFocused();
  await expect(page.getByRole("button", { name: "Add custom domain" })).toHaveCount(0);

  await page.goto(`${flitz}/app/settings/users`);
  await expect(page.getByRole("alert")).toContainText("Only admins manage users");
});

test("an admin saves the instance settings", async ({ page }) => {
  await signUp(page, "Edsger");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Settings" }).click();
  await page.getByRole("combobox", { name: "Time zone" }).selectOption("Europe/Berlin");
  await page.getByRole("spinbutton", { name: "Keep clicks for (months)" }).fill("24");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect(page.getByText("Settings saved")).toBeVisible();

  await page.reload();
  await expect(page.getByRole("combobox", { name: "Time zone" })).toHaveValue("Europe/Berlin");
  await expect(page.getByRole("spinbutton", { name: "Keep clicks for (months)" })).toHaveValue("24");
});

test("a user changes their own name", async ({ page }) => {
  await signUp(page, "Frances");
  await page.getByRole("button", { name: /Change your name$/ }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("  Frances Allen ");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("Name saved")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Frances Allen frances@example\.com/ })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("button", { name: /^Frances Allen frances@example\.com/ })).toBeVisible();
});

test("create a link with a custom slug on the instance domain, follow it, then deactivate and delete it", async ({ page }) => {
  const flitz = process.env.FLITZ_URL!;
  await signUp(page, "Katherine");

  await page.goto(`${flitz}/app/links/new`);
  await page.getByLabel("Slug", { exact: true }).fill("open-day");
  await page.getByRole("textbox", { name: "Default target" }).fill("https://example.com/open-day");
  await page.getByRole("button", { name: "Create link" }).click();
  await expect(page.getByRole("heading", { name: "Edit link" })).toBeVisible();

  const response = await page.request.get(`${flitz}/open-day`, { maxRedirects: 0 });
  expect(response.status()).toBe(302);
  expect(response.headers().location).toBe("https://example.com/open-day");

  await page.getByRole("button", { name: "Deactivate" }).click();
  await expect(page.getByText("Link deactivated")).toBeVisible();
  await page.getByRole("button", { name: "Delete link" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete link" }).click();
  await expect(page.getByText("Link deleted")).toBeVisible();
});

test("a signed-out deep link returns to the same page after sign-in", async ({ page, request }) => {
  const flitz = process.env.FLITZ_URL!;
  await request.get(await emailLink(request, await register(request, "Mira"), "Verify"));
  const created = await request.post(`${flitz}/api/links`, { data: { defaultTarget: "https://example.com/deep", title: "Deep link" } });
  const link = await created.json();

  await page.goto(`${flitz}/app/links/${link.id}/stats?bots=include`);
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await page.getByLabel("Email").fill("mira@example.com");
  await page.getByLabel("Password").fill("correct horse battery");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();

  await expect(page.getByRole("heading", { level: 1, name: "Deep link" })).toBeVisible();
  expect(page.url()).toBe(`${flitz}/app/links/${link.id}/stats?bots=include`);
});
