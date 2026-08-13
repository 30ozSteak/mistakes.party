import assert from "node:assert/strict";
import test from "node:test";
import {
  PARTY_PROTOCOL_VERSION,
  PARTY_REALTIME_PATH,
  PARTY_REALTIME_SUBPROTOCOL,
  PARTY_SESSION_STORAGE_KEY,
  PARTY_SIGNAL_KINDS,
  isPartyRoute,
  isPartySessionId,
  normalizePartyRoute,
  parsePartyClientMessageJson,
  parsePartyServerMessageJson,
  partyRealtimeWebSocketProtocols,
  partyRealtimeWebSocketUrl,
} from "../app/lib/partyProtocol.ts";
import {
  DEFAULT_PARTY_REALTIME_URL,
  normalizePartyRealtimeUrl,
} from "../app/lib/partyRealtimeConfig.ts";

test("defines one credential-free party protocol", () => {
  assert.equal(PARTY_PROTOCOL_VERSION, 1);
  assert.equal(PARTY_REALTIME_PATH, "/v1/party");
  assert.equal(PARTY_REALTIME_SUBPROTOCOL, "mistakes-party-presence-v1");
  assert.equal(PARTY_SESSION_STORAGE_KEY, "mistakes-party.presence.session.v1");
  assert.deepEqual(PARTY_SIGNAL_KINDS, [
    "cheers",
    "hi",
    "bad_idea",
    "i_was_here",
  ]);
  assert.deepEqual(partyRealtimeWebSocketProtocols(), [
    PARTY_REALTIME_SUBPROTOCOL,
  ]);
});

test("builds a route-local WebSocket URL without identity secrets", () => {
  const url = new URL(
    partyRealtimeWebSocketUrl(
      "https://realtime.example/base?ignored=1#ignored",
      "/blogs/?draft=1#feed",
      "session_public_01",
    ),
  );

  assert.equal(url.protocol, "wss:");
  assert.equal(url.host, "realtime.example");
  assert.equal(url.pathname, PARTY_REALTIME_PATH);
  assert.equal(url.searchParams.get("route"), "/blogs");
  assert.equal(url.searchParams.get("sessionId"), "session_public_01");
  assert.deepEqual([...url.searchParams.keys()].sort(), ["route", "sessionId"]);
});

test("accepts only canonical public routes and excludes Patreon", () => {
  for (const route of [
    "/",
    "/blogs",
    "/work/lighthouse-checker",
    "/code/repo-01",
  ]) {
    assert.equal(isPartyRoute(route), true, route);
  }

  for (const route of [
    "blogs",
    "/blogs/",
    "/blogs?draft=1",
    "/blogs#feed",
    "/blogs//post",
    "/../private",
    "/patreon",
    "/patreon/room",
    `/${"a".repeat(256)}`,
  ]) {
    assert.equal(isPartyRoute(route), false, route);
  }

  assert.equal(normalizePartyRoute("/blogs/?draft=1#feed"), "/blogs");
});

test("validates reconnect-only session identifiers", () => {
  assert.equal(isPartySessionId("session_public_01"), true);
  assert.equal(isPartySessionId("short"), false);
  assert.equal(isPartySessionId("contains a space"), false);
  assert.equal(isPartySessionId("x".repeat(129)), false);
});

test("parses only exact, bounded client messages", () => {
  assert.deepEqual(parsePartyClientMessageJson('{"type":"ping"}'), {
    type: "ping",
  });
  assert.deepEqual(
    parsePartyClientMessageJson(
      '{"type":"signal:send","kind":"bad_idea"}',
    ),
    { type: "signal:send", kind: "bad_idea" },
  );

  for (const value of [
    null,
    "not json",
    "[]",
    '{"type":"ping","extra":true}',
    '{"type":"signal:send","kind":"like"}',
    '{"type":"signal:send","kind":"hi","extra":true}',
    `{"type":"ping","padding":"${"x".repeat(513)}"}`,
  ]) {
    assert.equal(parsePartyClientMessageJson(value), null);
  }
});

test("strictly validates server messages before the UI consumes them", () => {
  const welcome = {
    type: "welcome",
    protocolVersion: 1,
    generation: "test-v1",
    route: "/blogs",
    sessionId: "session_public_01",
    presenceCount: 2,
  };
  const signal = {
    type: "signal",
    id: "8f6088ab-9f45-4f78-ae8c-4d63b7aa4000",
    kind: "cheers",
    sentAt: 1_786_563_000_000,
  };

  assert.deepEqual(parsePartyServerMessageJson(JSON.stringify(welcome)), welcome);
  assert.deepEqual(parsePartyServerMessageJson('{"type":"presence","presenceCount":3}'), {
    type: "presence",
    presenceCount: 3,
  });
  assert.deepEqual(parsePartyServerMessageJson(JSON.stringify(signal)), signal);
  assert.deepEqual(parsePartyServerMessageJson('{"type":"pong"}'), {
    type: "pong",
  });
  assert.deepEqual(
    parsePartyServerMessageJson(
      '{"type":"error","code":"RATE_LIMITED","message":"Slow down.","retryAfterMs":1000}',
    ),
    {
      type: "error",
      code: "RATE_LIMITED",
      message: "Slow down.",
      retryAfterMs: 1000,
    },
  );

  for (const value of [
    '{"type":"presence","presenceCount":-1}',
    '{"type":"presence","presenceCount":2,"extra":true}',
    '{"type":"signal","id":"client-id","kind":"hi","sentAt":1}',
    '{"type":"welcome","protocolVersion":2,"generation":"x","route":"/","sessionId":"session_public_01","presenceCount":1}',
    '{"type":"error","code":42,"message":"bad"}',
  ]) {
    assert.equal(parsePartyServerMessageJson(value), null);
  }
});

test("normalizes only credential-free HTTP relay origins", () => {
  assert.match(DEFAULT_PARTY_REALTIME_URL, /^https:\/\//);
  assert.equal(
    normalizePartyRealtimeUrl(" https://realtime.example/path?x=1#hash "),
    "",
  );
  assert.equal(
    normalizePartyRealtimeUrl("http://127.0.0.1:8787/"),
    "http://127.0.0.1:8787",
  );
  assert.equal(normalizePartyRealtimeUrl("https://user:pass@example.com"), "");
  assert.equal(normalizePartyRealtimeUrl("wss://realtime.example"), "");
  assert.equal(normalizePartyRealtimeUrl("not a url"), "");
});
