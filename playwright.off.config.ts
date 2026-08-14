import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_OFF_PORT ?? 3200);
const realtimePort = Number(process.env.PLAYWRIGHT_OFF_REALTIME_PORT ?? 8789);
const appUrl = `http://localhost:${port}`;
const realtimeUrl = `http://127.0.0.1:${realtimePort}`;
const realtimeStorage = `/tmp/mistakes-party-wrangler-off-${process.pid}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/party-off-mode.off.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: "list",
  outputDir: "test-results/playwright-off",
  use: {
    ...devices["Desktop Chrome"],
    baseURL: appUrl,
    trace: "on-first-retry",
  },
  webServer: [
    {
      command: `npm run dev:realtime -- --port ${realtimePort} --persist-to ${realtimeStorage} --var ALLOWED_ORIGINS:${appUrl} --var PARTY_MODE:off --var PARTY_HOUSE_MODE:off --var PARTY_GENERATION:playwright-off-v2`,
      url: `${realtimeUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
      env: {
        MEDIUM_FEED_URL: "http://127.0.0.1:9/playwright-offline-feed",
        MEDIUM_FEED_ALLOW_LOCALHOST: "1",
        NEXT_DIST_DIR: ".next-playwright-off",
        NEXT_PUBLIC_PARTY_REALTIME_URL: realtimeUrl,
      },
      url: appUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
