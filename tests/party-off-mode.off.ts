import { expect, test } from "@playwright/test";

const realtimePort = Number(process.env.PLAYWRIGHT_OFF_REALTIME_PORT ?? 8789);
const realtimeUrl = `ws://127.0.0.1:${realtimePort}`;

test("off mode rejects party presence and removes the site control", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("party-presence")).toHaveCount(0, {
    timeout: 10_000,
  });

  const result = await page.evaluate(async (baseUrl) => {
    return new Promise<{
      messages: Array<{
        type?: string;
        code?: string;
        message?: string;
        fatal?: boolean;
      }>;
      closeCode: number;
    }>((resolve, reject) => {
      const url = new URL(`${baseUrl}/v1/party`);
      url.searchParams.set("route", "/off-mode-test");
      const socket = new WebSocket(url, "mistakes-party-presence-v1");
      const messages: Array<{
        type?: string;
        code?: string;
        message?: string;
        fatal?: boolean;
      }> = [];
      const timer = window.setTimeout(
        () => reject(new Error("Party off-mode socket did not close")),
        10_000,
      );

      socket.addEventListener("message", (event) => {
        if (typeof event.data === "string") messages.push(JSON.parse(event.data));
      });
      socket.addEventListener("close", (event) => {
        window.clearTimeout(timer);
        resolve({ messages, closeCode: event.code });
      });
      socket.addEventListener("error", () => {
        // A policy close can also dispatch an error. The close event and
        // structured fatal message are the assertion boundary.
      });
    });
  }, realtimeUrl);

  expect(result.messages).toContainEqual({
    type: "error",
    code: "PARTY_DISABLED",
    message: "Party presence is disabled.",
    fatal: true,
  });
  expect(result.closeCode).toBe(1008);
});
