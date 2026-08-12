import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_DRAWING_REALTIME_URL,
  normalizeDrawingRealtimeUrl,
} from "../app/lib/drawingRealtimeConfig.ts";

test("accepts only credential-free HTTP relay origins", () => {
  assert.equal(
    normalizeDrawingRealtimeUrl(DEFAULT_DRAWING_REALTIME_URL),
    DEFAULT_DRAWING_REALTIME_URL,
  );
  assert.equal(
    normalizeDrawingRealtimeUrl("http://127.0.0.1:8787/"),
    "http://127.0.0.1:8787",
  );

  for (const value of [
    "wss://relay.example",
    "https://user:secret@relay.example",
    "https://relay.example/realtime",
    "https://relay.example?token=secret",
    "https://relay.example/#room",
    "javascript:alert(1)",
    "not a URL",
  ]) {
    assert.equal(normalizeDrawingRealtimeUrl(value), "", value);
  }
});
