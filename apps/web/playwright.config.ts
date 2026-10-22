import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/server.ts",
  timeout: 60_000,
  reporter: "list",
  use: { ...devices["Desktop Chrome"], permissions: ["clipboard-read", "clipboard-write"], trace: "retain-on-failure" },
});
