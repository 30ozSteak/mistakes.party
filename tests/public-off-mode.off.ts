import { expect, test } from "@playwright/test";

const realtimePort = Number(process.env.PLAYWRIGHT_OFF_REALTIME_PORT ?? 8789);
const realtimeUrl = `ws://127.0.0.1:${realtimePort}`;

test("off mode fences public WebSockets while private v1 rooms stay reachable", async ({
  page,
}) => {
  await page.goto("/");

  const publicResult = await page.evaluate(async (baseUrl) => {
    return new Promise<{
      messages: Array<{ type?: string; code?: string; fatal?: boolean }>;
      closeCode: number;
    }>((resolve, reject) => {
      const socket = new WebSocket(
        `${baseUrl}/v2/public/presence?route=%2Foff-mode-test`,
        "mistakes-party-drawing-v2",
      );
      const messages: Array<{ type?: string; code?: string; fatal?: boolean }> = [];
      const timer = window.setTimeout(
        () => reject(new Error("Public off-mode socket did not close")),
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
        // A compliant fatal WebSocket close can also dispatch `error`; the
        // close event remains the authoritative assertion boundary.
      });
    });
  }, realtimeUrl);

  expect(publicResult.messages).toContainEqual({
    type: "error",
    code: "PUBLIC_DISABLED",
    message: "Public drawing is disabled.",
    fatal: true,
  });
  expect(publicResult.closeCode).toBe(1008);

  const privateResult = await page.evaluate(async (baseUrl) => {
    const id = crypto.randomUUID().replaceAll("-", "_");
    const token = crypto.randomUUID().replaceAll("-", "_");
    const url = new URL(`${baseUrl}/v1/rooms/${id}`);
    url.searchParams.set("participantId", id);
    url.searchParams.set("name", "Off Mode Guest");
    url.searchParams.set("route", "/");

    return new Promise<{ type?: string; protocolVersion?: number }>(
      (resolve, reject) => {
        const socket = new WebSocket(url, [
          "mistakes-party-drawing-v1",
          `mistakes-party-auth.${token}`,
        ]);
        const timer = window.setTimeout(
          () => reject(new Error("Private v1 room did not welcome a participant")),
          10_000,
        );
        socket.addEventListener("message", (event) => {
          if (typeof event.data !== "string") return;
          const message = JSON.parse(event.data) as {
            type?: string;
            protocolVersion?: number;
          };
          if (message.type !== "welcome") return;
          window.clearTimeout(timer);
          socket.close(1000, "Off-mode regression complete");
          resolve(message);
        });
        socket.addEventListener("error", () => {
          window.clearTimeout(timer);
          reject(new Error("Private v1 socket failed"));
        });
      },
    );
  }, realtimeUrl);

  expect(privateResult).toMatchObject({ type: "welcome", protocolVersion: 1 });
});
