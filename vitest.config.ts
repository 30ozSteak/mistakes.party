import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./worker/wrangler.jsonc" },
    }),
  ],
  test: {
    include: ["tests/party-worker.test.ts"],
    // Cloudflare's current Workers pool requires shared storage for Durable
    // Object WebSocket tests. Keep this suite in one workerd process and use
    // unique generation names plus explicit cleanup inside the test support.
    isolate: false,
    maxWorkers: 1,
  },
});
