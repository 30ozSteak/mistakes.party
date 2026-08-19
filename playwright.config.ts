import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const managedBaseURL = `http://localhost:${port}`;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? managedBaseURL;

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
    : {
          command: `npm run dev -- --hostname 127.0.0.1 --port ${port}`,
          env: {
            NEXT_DIST_DIR: ".next-playwright",
            PATREON_ACCESS_PASSWORD: "playwright-member-password",
            PATREON_SESSION_SECRET:
              "playwright-session-secret-at-least-32-characters",
          },
          url: managedBaseURL,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
      },
});
