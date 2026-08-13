import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const siteOrigin = "https://www.mistakes.party";
const realtimeOrigin =
  "https://mistakes-party-drawing-realtime.mistakes.workers.dev";
const protocol = "mistakes-party-presence-v1";
const route = `/party-production-probe-${Date.now().toString(36)}-${crypto
  .randomUUID()
  .slice(0, 8)}`;

const healthResponse = await fetch(`${realtimeOrigin}/health`);
assert.equal(healthResponse.status, 200);
assert.deepEqual(await healthResponse.json(), {
  ok: true,
  service: "mistakes-party-realtime",
});

const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  await page.goto(siteOrigin, {
    timeout: 30_000,
    waitUntil: "domcontentloaded",
  });

  const result = await page.evaluate(
    ({ protocol, realtimeOrigin, route }) =>
      new Promise((resolve, reject) => {
        const url = new URL("/v1/party", realtimeOrigin);
        url.protocol = "wss:";
        url.searchParams.set("route", route);
        const socket = new WebSocket(url, [protocol]);
        let welcome;

        const timeout = window.setTimeout(() => {
          socket.close();
          reject(new Error("Timed out waiting for the party signal echo."));
        }, 15_000);

        socket.addEventListener("message", (event) => {
          const message = JSON.parse(String(event.data));
          if (message.type === "welcome") {
            welcome = message;
            socket.send(
              JSON.stringify({ type: "signal:send", kind: "i_was_here" }),
            );
            return;
          }
          if (message.type !== "signal" || message.kind !== "i_was_here") {
            return;
          }

          window.clearTimeout(timeout);
          const negotiatedProtocol = socket.protocol;
          socket.close(1000, "Production smoke complete");
          resolve({
            negotiatedProtocol,
            signal: message,
            welcome,
          });
        });
        socket.addEventListener("error", () => {
          window.clearTimeout(timeout);
          reject(new Error("The production party WebSocket failed."));
        });
        socket.addEventListener("close", () => {
          if (!welcome) {
            window.clearTimeout(timeout);
            reject(new Error("The production party WebSocket closed early."));
          }
        });
      }),
    { protocol, realtimeOrigin, route },
  );

  assert.equal(result.negotiatedProtocol, protocol);
  assert.equal(result.welcome?.type, "welcome");
  assert.equal(result.welcome?.protocolVersion, 1);
  assert.equal(result.welcome?.route, route);
  assert.match(result.welcome?.sessionId ?? "", /^[A-Za-z0-9_-]{8,128}$/);
  assert.equal(result.signal?.type, "signal");
  assert.equal(result.signal?.kind, "i_was_here");
  assert.match(
    result.signal?.id ?? "",
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );

  console.log(`Production party smoke passed on ${route}.`);
} finally {
  await browser.close();
}
