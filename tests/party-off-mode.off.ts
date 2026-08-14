import { expect, test } from "@playwright/test";

const realtimePort = Number(process.env.PLAYWRIGHT_OFF_REALTIME_PORT ?? 8789);
const realtimeUrl = `ws://127.0.0.1:${realtimePort}`;

type PolicyClose = {
  messages: Array<{
    type?: string;
    code?: string;
    message?: string;
    fatal?: boolean;
  }>;
  closeCode: number;
};

test("house-off mode removes Living Glass and rejects a v2 socket", async ({
  page,
}) => {
  await page.goto("/");

  await expect(page.getByTestId("party-house")).toHaveCount(0, {
    timeout: 10_000,
  });
  await expect(page.getByTestId("party-switchboard")).toHaveCount(0);
  await expect(page.getByTestId("party-light")).toHaveCount(0);

  const result = await page.evaluate(async (baseUrl) => {
    return new Promise<PolicyClose>((resolve, reject) => {
      const socket = new WebSocket(
        new URL("/v2/house", baseUrl),
        "mistakes-party-house-v2",
      );
      const messages: PolicyClose["messages"] = [];
      const timer = window.setTimeout(
        () => reject(new Error("Living Glass off-mode socket did not close")),
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
        // Policy closes may also dispatch an error; the structured message and
        // close code are the stable assertion boundary.
      });
    });
  }, realtimeUrl);

  expect(result.messages).toEqual([
    { type: "error", code: "PARTY_DISABLED", fatal: true },
  ]);
  expect(result.closeCode).toBe(1008);
});
