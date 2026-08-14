import assert from "node:assert/strict";
import { chromium } from "@playwright/test";

const siteOrigin = "https://www.mistakes.party";
const realtimeOrigin =
  "https://mistakes-party-drawing-realtime.mistakes.workers.dev";
const houseProtocol = "mistakes-party-house-v2";
const legacyProtocol = "mistakes-party-presence-v1";
const expectedHouseMode =
  process.env.PARTY_HOUSE_EXPECTED_MODE?.trim() || "live";
assert.match(expectedHouseMode, /^(?:presence|live)$/);
const legacyRoute = `/party-production-v1-compat-${Date.now().toString(36)}-${crypto
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
    async ({
      expectedHouseMode,
      houseProtocol,
      legacyProtocol,
      legacyRoute,
      realtimeOrigin,
    }) => {
      async function probeHouse() {
        const clients = new Set();

        function waitFor(client, type, predicate = () => true) {
          const existing = client.messages.find(
            (message) => message.type === type && predicate(message),
          );
          if (existing) return Promise.resolve(existing);
          return new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              cleanup();
              reject(new Error(`Timed out waiting for v2 ${type}.`));
            }, 15_000);
            const handleMessage = (event) => {
              const message = JSON.parse(String(event.data));
              if (message.type === "error" && message.fatal) {
                cleanup();
                reject(
                  new Error(`The v2 house rejected the probe: ${message.code}`),
                );
                return;
              }
              if (message.type !== type || !predicate(message)) return;
              cleanup();
              resolve(message);
            };
            const handleClose = () => {
              cleanup();
              reject(new Error(`The v2 socket closed before ${type}.`));
            };
            function cleanup() {
              window.clearTimeout(timeout);
              client.socket.removeEventListener("message", handleMessage);
              client.socket.removeEventListener("close", handleClose);
            }
            client.socket.addEventListener("message", handleMessage);
            client.socket.addEventListener("close", handleClose);
          });
        }

        async function openClient(session = null) {
          const url = new URL("/v2/house", realtimeOrigin);
          url.protocol = "wss:";
          const socket = new WebSocket(url, [houseProtocol]);
          const client = { messages: [], socket, url: url.href };
          clients.add(client);
          socket.addEventListener("message", (event) => {
            client.messages.push(JSON.parse(String(event.data)));
          });
          await new Promise((resolve, reject) => {
            const timeout = window.setTimeout(() => {
              reject(new Error("Timed out opening a production v2 socket."));
            }, 15_000);
            socket.addEventListener("open", () => {
              window.clearTimeout(timeout);
              resolve();
            }, { once: true });
            socket.addEventListener("error", () => {
              window.clearTimeout(timeout);
              reject(new Error("The production v2 house WebSocket failed."));
            }, { once: true });
          });
          const welcomePromise = waitFor(client, "house:welcome");
          socket.send(
            JSON.stringify({
              type: "house:hello",
              generation: session?.generation ?? null,
              sessionId: session?.sessionId ?? null,
            }),
          );
          return {
            ...client,
            welcome: await welcomePromise,
          };
        }

        async function closeClient(client) {
          if (client.socket.readyState >= WebSocket.CLOSING) return;
          await new Promise((resolve) => {
            const timeout = window.setTimeout(resolve, 2_000);
            client.socket.addEventListener("close", () => {
              window.clearTimeout(timeout);
              resolve();
            }, { once: true });
            client.socket.close(1000, "Production v2 smoke checkpoint");
          });
        }

        let first;
        let second;
        let reconnect;
        let late;
        try {
          first = await openClient();
          const countWithFirst = first.welcome.presenceCount;
          second = await openClient();
          const countWithTwo = await waitFor(
            first,
            "house:snapshot",
            (message) => message.presenceCount >= countWithFirst + 1,
          );

          const pongPromise = waitFor(first, "pong");
          first.socket.send(JSON.stringify({ type: "ping" }));
          const pong = await pongPromise;

          let knock = null;
          let afterInteraction = countWithTwo.afterglow;
          if (expectedHouseMode === "live") {
            const requestId = crypto.randomUUID();
            const knockPromise = waitFor(
              second,
              "knock",
              (message) => message.requestId === requestId,
            );
            const afterglowPromise = waitFor(
              first,
              "house:snapshot",
              (message) =>
                message.afterglow.intensity >
                countWithTwo.afterglow.intensity,
            );
            first.socket.send(
              JSON.stringify({ type: "knock:send", requestId, zone: 4 }),
            );
            knock = await knockPromise;
            afterInteraction = (await afterglowPromise).afterglow;
          }

          const reconnectSession = {
            generation: second.welcome.generation,
            sessionId: second.welcome.sessionId,
          };
          const departurePromise = waitFor(
            first,
            "house:snapshot",
            (message) => message.presenceCount <= countWithTwo.presenceCount - 1,
          );
          await closeClient(second);
          await departurePromise;
          reconnect = await openClient(reconnectSession);

          const reconnectIdentityMatches =
            reconnect.welcome.sessionId === second.welcome.sessionId &&
            reconnect.welcome.self.id === second.welcome.self.id;
          await Promise.all([closeClient(first), closeClient(reconnect)]);
          await new Promise((resolve) => window.setTimeout(resolve, 1_000));

          late = await openClient();
          const result = {
            afterInteraction,
            countWithFirst,
            countWithTwo: countWithTwo.presenceCount,
            idleAfterglow: late.welcome.afterglow,
            knock,
            negotiatedProtocol: houseProtocol,
            pong,
            reconnectIdentityMatches,
            requestedUrl: first.url,
            welcome: first.welcome,
            secondWelcome: second.welcome,
          };
          await closeClient(late);
          return result;
        } finally {
          for (const client of clients) {
            if (client.socket.readyState < WebSocket.CLOSING) {
              client.socket.close(1000, "Production v2 smoke cleanup");
            }
          }
        }
      }

      function probeLegacy() {
        return new Promise((resolve, reject) => {
          const url = new URL("/v1/party", realtimeOrigin);
          url.protocol = "wss:";
          url.searchParams.set("route", legacyRoute);
          const socket = new WebSocket(url, [legacyProtocol]);
          let settled = false;
          let welcome;
          const timeout = window.setTimeout(() => {
            socket.close();
            reject(new Error("Timed out waiting for the v1 compatibility pong."));
          }, 15_000);

          socket.addEventListener("message", (event) => {
            const message = JSON.parse(String(event.data));
            if (message.type === "welcome") {
              welcome = message;
              socket.send(JSON.stringify({ type: "ping" }));
              return;
            }
            if (message.type !== "pong" || !welcome) return;

            window.clearTimeout(timeout);
            settled = true;
            const negotiatedProtocol = socket.protocol;
            socket.close(1000, "Production v1 compatibility smoke complete");
            resolve({ negotiatedProtocol, pong: message, welcome });
          });
          socket.addEventListener("error", () => {
            if (settled) return;
            window.clearTimeout(timeout);
            settled = true;
            reject(new Error("The production v1 compatibility socket failed."));
          });
          socket.addEventListener("close", () => {
            if (settled) return;
            window.clearTimeout(timeout);
            settled = true;
            reject(new Error("The production v1 compatibility socket closed early."));
          });
        });
      }

      return {
        house: await probeHouse(),
        legacy: await probeLegacy(),
      };
    },
    {
      expectedHouseMode,
      houseProtocol,
      legacyProtocol,
      legacyRoute,
      realtimeOrigin,
    },
  );

  assert.equal(result.house.negotiatedProtocol, houseProtocol);
  const houseUrl = new URL(result.house.requestedUrl);
  assert.equal(houseUrl.pathname, "/v2/house");
  assert.equal(houseUrl.search, "");
  assert.deepEqual(result.house.pong, { type: "pong" });
  assert.equal(result.house.welcome?.type, "house:welcome");
  assert.equal(result.house.welcome?.protocolVersion, 2);
  assert.equal(result.house.welcome?.mode, expectedHouseMode);
  assert.match(result.house.welcome?.generation ?? "", /^[A-Za-z0-9_-]{1,64}$/);
  assert.match(result.house.welcome?.sessionId ?? "", /^[A-Za-z0-9_-]{8,128}$/);
  assert.match(result.house.welcome?.self?.id ?? "", /^[A-Za-z0-9_-]{8,128}$/);
  assert.ok(Number.isInteger(result.house.welcome?.presenceCount));
  assert.ok(result.house.welcome.presenceCount >= 1);
  assert.ok(result.house.welcome.presenceCount <= 512);
  assert.ok(result.house.welcome.lights.length <= 12);
  assert.equal(result.house.welcome.afterglow.windowMs, 86_400_000);
  assert.ok(result.house.welcome.afterglow.intensity >= 0);
  assert.ok(result.house.welcome.afterglow.intensity <= 1_000);
  const weightTotal = result.house.welcome.afterglow.weights.reduce(
    (sum, weight) => sum + weight,
    0,
  );
  assert.ok(weightTotal === 0 || weightTotal === 1_000);
  assert.ok(result.house.countWithTwo >= result.house.countWithFirst + 1);
  assert.ok(
    result.house.secondWelcome.presenceCount >=
      result.house.countWithFirst + 1,
  );
  assert.equal(result.house.secondWelcome.mode, expectedHouseMode);
  assert.equal(result.house.reconnectIdentityMatches, true);
  assert.equal(result.house.idleAfterglow.windowMs, 86_400_000);
  assert.ok(result.house.idleAfterglow.intensity > 0);
  const idleWeightTotal = result.house.idleAfterglow.weights.reduce(
    (sum, weight) => sum + weight,
    0,
  );
  assert.equal(idleWeightTotal, 1_000);
  if (expectedHouseMode === "live") {
    assert.equal(result.house.knock?.type, "knock");
    assert.equal(result.house.knock?.zone, 4);
    assert.ok(
      result.house.afterInteraction.intensity >
        result.house.welcome.afterglow.intensity,
    );
  } else {
    assert.equal(result.house.knock, null);
  }

  assert.equal(result.legacy.negotiatedProtocol, legacyProtocol);
  assert.deepEqual(result.legacy.pong, { type: "pong" });
  assert.equal(result.legacy.welcome?.type, "welcome");
  assert.equal(result.legacy.welcome?.protocolVersion, 1);
  assert.equal(result.legacy.welcome?.route, legacyRoute);

  console.log(
    `Production Living Glass v2 smoke and v1 compatibility probe passed (${legacyRoute}).`,
  );
} finally {
  await browser.close();
}
