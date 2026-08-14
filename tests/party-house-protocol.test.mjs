import assert from "node:assert/strict";
import test from "node:test";
import {
  PARTY_HOUSE_PROTOCOL_VERSION,
  PARTY_HOUSE_REALTIME_PATH,
  PARTY_HOUSE_REALTIME_SUBPROTOCOL,
  PARTY_HOUSE_SESSION_STORAGE_KEY,
  isPartyHouseRequestId,
  parsePartyHouseClientMessageJson,
  parsePartyHouseServerMessageJson,
  partyHouseRealtimeWebSocketProtocols,
  partyHouseRealtimeWebSocketUrl,
} from "../app/lib/partyHouseProtocol.ts";

const light = {
  id: "abcdefghijklmnoq",
  color: 2,
  seed: 4_294_967_295,
  zone: 4,
  energy: 1,
  sharing: false,
};

const afterglow = {
  weights: [100, 200, 300, 400],
  intensity: 750,
  asOf: 1_786_563_000_000,
  windowMs: 86_400_000,
};

test("defines the Living Glass v2 endpoint without changing v1", () => {
  assert.equal(PARTY_HOUSE_PROTOCOL_VERSION, 2);
  assert.equal(PARTY_HOUSE_REALTIME_PATH, "/v2/house");
  assert.equal(
    PARTY_HOUSE_REALTIME_SUBPROTOCOL,
    "mistakes-party-house-v2",
  );
  assert.equal(
    PARTY_HOUSE_SESSION_STORAGE_KEY,
    "mistakes-party.house.session.v2",
  );
  assert.deepEqual(partyHouseRealtimeWebSocketProtocols(), [
    PARTY_HOUSE_REALTIME_SUBPROTOCOL,
  ]);
});

test("builds one credential-free, query-free house URL", () => {
  const url = new URL(
    partyHouseRealtimeWebSocketUrl(
      "https://realtime.example/ignored?route=%2Fsecret#ignored",
    ),
  );

  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "realtime.example");
  assert.equal(url.pathname, PARTY_HOUSE_REALTIME_PATH);
  assert.equal(url.search, "");
  assert.equal(url.hash, "");
});

test("accepts only exact, bounded Living Glass client messages", () => {
  const hello = {
    type: "house:hello",
    generation: null,
    sessionId: null,
  };
  const reconnect = {
    type: "house:hello",
    generation: "living-glass-v2",
    sessionId: "session_public_01",
  };
  const knock = {
    type: "knock:send",
    requestId: "8f6088ab-9f45-4f78-ae8c-4d63b7aa4000",
    zone: 8,
  };
  const move = {
    type: "light:move",
    zone: 0,
    energy: 2,
    sharing: true,
  };

  for (const message of [hello, reconnect, knock, move, { type: "ping" }]) {
    assert.deepEqual(
      parsePartyHouseClientMessageJson(JSON.stringify(message)),
      message,
    );
  }
  assert.equal(isPartyHouseRequestId(knock.requestId), true);

  for (const value of [
    null,
    "not json",
    "[]",
    '{"type":"house:hello","generation":null,"sessionId":null,"route":"/private"}',
    '{"type":"house:hello","generation":"bad generation","sessionId":null}',
    '{"type":"house:hello","generation":null,"sessionId":"short"}',
    '{"type":"knock:send","requestId":"client-id","zone":4}',
    '{"type":"knock:send","requestId":"8f6088ab-9f45-4f78-ae8c-4d63b7aa4000","zone":9}',
    '{"type":"light:move","zone":4,"energy":3,"sharing":true}',
    '{"type":"light:move","zone":4,"energy":1,"sharing":1}',
    '{"type":"ping","extra":true}',
    `{"type":"ping","padding":"${"x".repeat(2_049)}"}`,
  ]) {
    assert.equal(parsePartyHouseClientMessageJson(value), null, String(value));
  }
});

test("strictly validates every Living Glass server message", () => {
  const welcome = {
    type: "house:welcome",
    protocolVersion: 2,
    generation: "living-glass-v2",
    mode: "live",
    sessionId: "session_public_01",
    self: light,
    presenceCount: 1,
    lights: [light],
    afterglow,
  };
  const snapshot = {
    type: "house:snapshot",
    presenceCount: 14,
    lights: Array.from({ length: 12 }, (_, index) => ({
      ...light,
      id: `abcdefghijklm${String(index).padStart(3, "0")}`,
      color: index % 4,
    })),
    afterglow,
  };
  const move = {
    type: "light:move",
    lightId: light.id,
    zone: 7,
    energy: 2,
    sharing: true,
  };
  const knock = {
    type: "knock",
    eventId: "8f6088ab-9f45-4f78-ae8c-4d63b7aa4000",
    requestId: "a1fb88ab-9f45-4f78-ae8c-4d63b7aa4bbb",
    lightId: light.id,
    color: 2,
    zone: 4,
    sentAt: 1_786_563_000_000,
  };

  for (const message of [
    welcome,
    snapshot,
    move,
    knock,
    { type: "pong" },
    { type: "error", code: "MODE_DISABLED", fatal: false },
  ]) {
    assert.deepEqual(
      parsePartyHouseServerMessageJson(JSON.stringify(message)),
      message,
    );
  }

  const invalid = [
    { ...welcome, protocolVersion: 1 },
    { ...welcome, mode: "off" },
    { ...welcome, presenceCount: 513 },
    { ...welcome, lights: Array.from({ length: 13 }, () => light) },
    { ...snapshot, afterglow: { ...afterglow, weights: [1, 2, 3] } },
    { ...snapshot, afterglow: { ...afterglow, weights: [1, 2, 3, 5] } },
    { ...move, zone: -1 },
    { ...move, lightId: "contains a space" },
    { ...knock, color: 4 },
    { ...knock, requestId: "not-a-uuid" },
    { type: "error", code: "bad-code", fatal: false },
    { type: "error", code: "MODE_DISABLED", fatal: 0 },
    { type: "pong", extra: true },
  ];

  for (const message of invalid) {
    assert.equal(
      parsePartyHouseServerMessageJson(JSON.stringify(message)),
      null,
      JSON.stringify(message),
    );
  }
});
