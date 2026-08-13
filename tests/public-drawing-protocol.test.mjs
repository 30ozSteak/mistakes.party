import assert from "node:assert/strict";
import test from "node:test";
import {
  PUBLIC_DRAWING_AUTH_PREFIX,
  PUBLIC_DRAWING_SESSION_KEY,
  PUBLIC_DRAWING_SUBPROTOCOL,
  parsePublicMessage,
  publicPodUrl,
  publicPresenceUrl,
  publicWebSocketProtocols,
  readPublicIdentity,
  storePublicIdentity,
} from "../app/components/publicDrawingClient.ts";
import {
  isPublicDrawingRoute,
  normalizeDrawingRoute,
} from "../app/lib/drawingRealtimeProtocol.ts";

const identity = {
  id: "session_public_01",
  name: "Acid Badger",
  token: "secret_session_token_01",
};

function memoryStorage() {
  const values = new Map();
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    removeItem(key) {
      values.delete(key);
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
  };
}

test("builds credential-safe presence and pod WebSocket requests", () => {
  const presence = new URL(
    publicPresenceUrl("https://realtime.example/", "/blogs?draft=1", identity),
  );
  assert.equal(presence.protocol, "wss:");
  assert.equal(presence.pathname, "/v2/public/presence");
  assert.equal(presence.searchParams.get("route"), "/blogs?draft=1");
  assert.equal(presence.searchParams.get("sessionId"), identity.id);
  assert.equal(presence.searchParams.get("name"), identity.name);
  assert.equal(presence.toString().includes(identity.token), false);

  const pod = new URL(
    publicPodUrl(
      "https://realtime.example/",
      {
        podId: "pod/with punctuation",
        role: "drawer",
        grant: "one_use_grant_01",
        expiresAt: Date.now() + 15_000,
      },
      "/blogs",
      identity,
    ),
  );
  assert.equal(pod.protocol, "wss:");
  assert.equal(pod.pathname, "/v2/public/pods/pod%2Fwith%20punctuation");
  assert.equal(pod.searchParams.get("grant"), "one_use_grant_01");
  assert.equal(pod.toString().includes(identity.token), false);
  assert.deepEqual(publicWebSocketProtocols(identity.token), [
    PUBLIC_DRAWING_SUBPROTOCOL,
    `${PUBLIC_DRAWING_AUTH_PREFIX}${identity.token}`,
  ]);
  assert.deepEqual(publicWebSocketProtocols(), [PUBLIC_DRAWING_SUBPROTOCOL]);
});

test("parses only bounded JSON objects with a string message type", () => {
  assert.deepEqual(parsePublicMessage('{"type":"presence:count","sessionCount":2}'), {
    type: "presence:count",
    sessionCount: 2,
  });
  assert.equal(parsePublicMessage(null), null);
  assert.equal(parsePublicMessage("not json"), null);
  assert.equal(parsePublicMessage("[]"), null);
  assert.equal(parsePublicMessage('{"type":42}'), null);
  assert.equal(parsePublicMessage(`{"type":"error","padding":"${"x".repeat(16 * 1024 * 1024)}"}`), null);
});

test("accepts only canonical bounded public pathnames", () => {
  for (const route of ["/", "/blogs", "/work/lighthouse-checker", "/code/repo-01"]) {
    assert.equal(isPublicDrawingRoute(route), true, route);
  }

  for (const route of [
    "blogs",
    "/blogs/",
    "/blogs?draft=1",
    "/blogs#feed",
    "/blogs//post",
    "/../private",
    `/${"a".repeat(256)}`,
  ]) {
    assert.equal(isPublicDrawingRoute(route), false, route);
  }
  assert.equal(normalizeDrawingRoute("/blogs/?draft=1#feed"), "/blogs");
});

test("preserves author generations and lifecycle epochs in v2 messages", () => {
  assert.deepEqual(
    parsePublicMessage(
      JSON.stringify({
        type: "stroke:append",
        authorId: "drawer_01",
        authorGeneration: 3,
        strokeId: "stroke_01",
        sequence: 8,
        points: [0.2, 0.3, 0.4, 0.5],
        bounds: { minX: 0.2, minY: 0.3, maxX: 0.4, maxY: 0.5 },
        epoch: 4,
        revision: 19,
      }),
    ),
    {
      type: "stroke:append",
      authorId: "drawer_01",
      authorGeneration: 3,
      strokeId: "stroke_01",
      sequence: 8,
      points: [0.2, 0.3, 0.4, 0.5],
      bounds: { minX: 0.2, minY: 0.3, maxX: 0.4, maxY: 0.5 },
      epoch: 4,
      revision: 19,
    },
  );
  assert.deepEqual(
    parsePublicMessage(
      '{"type":"pod:expired","epoch":5,"revision":20}',
    ),
    { type: "pod:expired", epoch: 5, revision: 20 },
  );
});

test("keeps the anonymous public credential in sessionStorage only", () => {
  const previousWindow = globalThis.window;
  const sessionStorage = memoryStorage();
  globalThis.window = { sessionStorage };

  try {
    assert.equal(readPublicIdentity(), null);
    storePublicIdentity(identity);
    assert.deepEqual(readPublicIdentity(), identity);
    assert.deepEqual(
      JSON.parse(sessionStorage.getItem(PUBLIC_DRAWING_SESSION_KEY)),
      identity,
    );

    sessionStorage.setItem(PUBLIC_DRAWING_SESSION_KEY, "{malformed");
    assert.equal(readPublicIdentity(), null);
    sessionStorage.setItem(
      PUBLIC_DRAWING_SESSION_KEY,
      JSON.stringify({ ...identity, token: 123 }),
    );
    assert.equal(readPublicIdentity(), null);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
