import { defineConfig, devices } from "@playwright/test";

// Dedicated defaults keep managed E2E services from reusing a developer's
// already-running `next dev` or Wrangler process with different environment.
const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const realtimePort = Number(process.env.PLAYWRIGHT_REALTIME_PORT ?? 8788);
const managedBaseURL = `http://localhost:${port}`;
const managedRealtimeURL = `http://127.0.0.1:${realtimePort}`;
const managedOrigin = `http://localhost:${port}`;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? managedBaseURL;
const managedRealtimeStorage = `/tmp/mistakes-party-wrangler-${process.pid}`;

export default defineConfig({
  testDir: "./tests",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? "github" : "list",
  outputDir: "test-results/playwright",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : [
        {
          command: `npm run dev:realtime -- --port ${realtimePort} --persist-to ${managedRealtimeStorage} --var ALLOWED_ORIGINS:${managedOrigin} --var PARTY_MODE:live --var PARTY_GENERATION:playwright-v1`,
          url: `${managedRealtimeURL}/health`,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
        {
          command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
          env: {
            GITHUB_REPOS_ALLOW_LOCALHOST: "1",
            GITHUB_REPOS_URL:
              "http://127.0.0.1:9/playwright-offline-github",
            MEDIUM_FEED_URL: "http://127.0.0.1:9/playwright-offline-feed",
            MEDIUM_FEED_ALLOW_LOCALHOST: "1",
            NEXT_DIST_DIR: ".next-playwright",
            NEXT_PUBLIC_PARTY_REALTIME_URL: managedRealtimeURL,
            PATREON_ACCESS_PASSWORD: "playwright-member-password",
            PATREON_SESSION_SECRET:
              "playwright-session-secret-at-least-32-characters",
          },
          url: managedBaseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        },
      ],
});
