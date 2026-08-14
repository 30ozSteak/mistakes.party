/* eslint-disable @typescript-eslint/triple-slash-reference -- The Workers pool
 * injects ambient bindings and runtime modules through generated declarations. */
/// <reference path="../worker/env.d.ts" />
/// <reference types="@cloudflare/workers-types" />
/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import {
  evictDurableObject,
  reset,
  runDurableObjectAlarm,
  runInDurableObject,
} from "cloudflare:test";
import { afterEach, describe, expect, it } from "vitest";
import {
  PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
  PARTY_HOUSE_REALTIME_SUBPROTOCOL,
  parsePartyHouseServerMessageJson,
  type PartyHouseServerMessage,
} from "../app/lib/partyHouseProtocol";
import worker, { PartyHouse } from "../worker/src/index";

const ORIGIN = "http://localhost:3000";
const HOUSE_URL = `${ORIGIN}/v2/house`;
const openSockets = new Set<WebSocket>();

type HouseSocket = {
  socket: WebSocket;
  messages: PartyHouseServerMessage[];
  waitFor<T extends PartyHouseServerMessage["type"]>(
    type: T,
    predicate?: (
      message: Extract<PartyHouseServerMessage, { type: T }>,
    ) => boolean,
  ): Promise<Extract<PartyHouseServerMessage, { type: T }>>;
};

function houseRequest(url = HOUSE_URL): Request {
  return new Request(url, {
    headers: {
      origin: ORIGIN,
      upgrade: "websocket",
      "sec-websocket-protocol": PARTY_HOUSE_REALTIME_SUBPROTOCOL,
    },
  });
}

async function waitForMessage<T extends PartyHouseServerMessage["type"]>(
  socket: WebSocket,
  messages: PartyHouseServerMessage[],
  type: T,
  predicate: (
    message: Extract<PartyHouseServerMessage, { type: T }>,
  ) => boolean = () => true,
): Promise<Extract<PartyHouseServerMessage, { type: T }>> {
  const existing = messages.find(
    (message): message is Extract<PartyHouseServerMessage, { type: T }> =>
      message.type === type && predicate(message as never),
  );
  if (existing) return existing;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for ${type}`)),
      3_000,
    );
    const onMessage = (event: MessageEvent) => {
      const message = parsePartyHouseServerMessageJson(event.data);
      if (message?.type !== type || !predicate(message as never)) return;
      clearTimeout(timer);
      socket.removeEventListener("message", onMessage);
      resolve(message as Extract<PartyHouseServerMessage, { type: T }>);
    };
    socket.addEventListener("message", onMessage);
  });
}

async function openHouse(): Promise<HouseSocket> {
  const response = await worker.fetch(houseRequest(), env);
  expect(response.status).toBe(101);
  expect(response.headers.get("sec-websocket-protocol")).toBe(
    PARTY_HOUSE_REALTIME_SUBPROTOCOL,
  );
  const socket = response.webSocket;
  if (!socket) throw new Error("Expected a WebSocket upgrade");
  socket.accept();
  openSockets.add(socket);
  const messages: PartyHouseServerMessage[] = [];
  socket.addEventListener("message", (event) => {
    const message = parsePartyHouseServerMessageJson(event.data);
    if (message) messages.push(message);
  });
  return {
    messages,
    socket,
    waitFor: (type, predicate) =>
      waitForMessage(socket, messages, type, predicate),
  };
}

async function hello(
  house: HouseSocket,
  session?: { generation: string; sessionId: string } | null,
) {
  house.socket.send(
    JSON.stringify({
      type: "house:hello",
      generation: session?.generation ?? null,
      sessionId: session?.sessionId ?? null,
    }),
  );
  return house.waitFor("house:welcome");
}

function send(house: HouseSocket, message: object): void {
  house.socket.send(JSON.stringify(message));
}

function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

afterEach(async () => {
  for (const socket of openSockets) {
    try {
      socket.close(1000, "Test complete");
    } catch {
      // A fatal policy close may already have ended the connection.
    }
  }
  openSockets.clear();
  await reset();
});

describe("Living Glass Worker endpoint", () => {
  it("requires the v2 path, exact subprotocol, no query, and a hello first", async () => {
    const noUpgrade = await worker.fetch(
      new Request(HOUSE_URL, { headers: { origin: ORIGIN } }),
      env,
    );
    expect(noUpgrade.status).toBe(426);

    const wrongProtocol = await worker.fetch(
      new Request(HOUSE_URL, {
        headers: {
          origin: ORIGIN,
          upgrade: "websocket",
          "sec-websocket-protocol": "mistakes-party-presence-v1",
        },
      }),
      env,
    );
    expect(wrongProtocol.status).toBe(400);

    const query = await worker.fetch(houseRequest(`${HOUSE_URL}?route=/secret`), env);
    expect(query.status).toBe(400);

    const house = await openHouse();
    send(house, { type: "knock:send", requestId: uuid(900), zone: 4 });
    await expect(house.waitFor("error")).resolves.toEqual({
      type: "error",
      code: "HELLO_REQUIRED",
      fatal: true,
    });
  });

  it("issues an anonymous welcome and counts duplicate sockets once", async () => {
    const first = await openHouse();
    const firstWelcome = await hello(first);
    expect(firstWelcome).toMatchObject({
      type: "house:welcome",
      protocolVersion: 2,
      generation: expect.any(String),
      mode: "live",
      presenceCount: 1,
      self: {
        color: expect.any(Number),
        energy: 0,
        sharing: false,
        zone: 4,
      },
    });
    expect(firstWelcome.afterglow.intensity).toBeGreaterThanOrEqual(240);
    expect(firstWelcome.sessionId).not.toBe(firstWelcome.self.id);

    const duplicate = await openHouse();
    const duplicateWelcome = await hello(duplicate, firstWelcome);
    expect(duplicateWelcome.presenceCount).toBe(1);
    expect(duplicateWelcome.self).toEqual(firstWelcome.self);
    expect(duplicateWelcome.afterglow.intensity).toBeGreaterThanOrEqual(240);

    const third = await openHouse();
    send(third, {
      type: "house:hello",
      generation: firstWelcome.generation,
      sessionId: firstWelcome.sessionId,
    });
    await expect(third.waitFor("error")).resolves.toEqual({
      type: "error",
      code: "SESSION_LIMIT",
      fatal: true,
    });

    const doubleHello = await openHouse();
    send(doubleHello, {
      type: "house:hello",
      generation: null,
      sessionId: null,
    });
    send(doubleHello, {
      type: "house:hello",
      generation: null,
      sessionId: null,
    });
    await expect(doubleHello.waitFor("house:welcome")).resolves.toMatchObject({
      presenceCount: 2,
    });
    await expect(doubleHello.waitFor("error")).resolves.toEqual({
      type: "error",
      code: "HELLO_ALREADY_RECEIVED",
      fatal: true,
    });
    expect(
      doubleHello.messages.filter(({ type }) => type === "house:welcome"),
    ).toHaveLength(1);
  });

  it("broadcasts bounded moves and KNOCK while deduping afterglow", async () => {
    const sender = await openHouse();
    const peer = await openHouse();
    const senderWelcome = await hello(sender);
    await hello(peer);
    const duplicate = await openHouse();
    await hello(duplicate, senderWelcome);

    send(sender, { type: "light:move", zone: 8, energy: 2, sharing: true });
    await expect(
      peer.waitFor("light:move", (message) => message.lightId === senderWelcome.self.id),
    ).resolves.toMatchObject({ zone: 8, energy: 2, sharing: true });
    send(sender, { type: "light:move", zone: 7, energy: 1, sharing: true });
    await expect(sender.waitFor("error", (message) => !message.fatal)).resolves.toMatchObject({
      code: "RATE_LIMITED",
    });
    send(sender, { type: "light:move", zone: 8, energy: 0, sharing: false });
    await expect(
      peer.waitFor(
        "light:move",
        (message) =>
          message.lightId === senderWelcome.self.id && !message.sharing,
      ),
    ).resolves.toMatchObject({ energy: 0, sharing: false, zone: 4 });
    const peerMoveCount = peer.messages.filter(
      ({ type }) => type === "light:move",
    ).length;
    send(sender, { type: "light:move", zone: 0, energy: 2, sharing: false });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(
      peer.messages.filter(({ type }) => type === "light:move"),
    ).toHaveLength(peerMoveCount);

    send(sender, { type: "knock:send", requestId: uuid(1), zone: 8 });
    const knock = await peer.waitFor("knock", (message) => message.requestId === uuid(1));
    expect(knock).toMatchObject({
      lightId: senderWelcome.self.id,
      color: senderWelcome.self.color,
      zone: 8,
    });
    const afterFirst = await peer.waitFor(
      "house:snapshot",
      (message) => message.afterglow.intensity > 0,
    );

    send(duplicate, { type: "knock:send", requestId: uuid(2), zone: 4 });
    await expect(
      duplicate.waitFor("error", (message) => !message.fatal),
    ).resolves.toMatchObject({ code: "RATE_LIMITED" });

    const stub = env.PARTY_HOUSE.getByName(`party-house:${senderWelcome.generation}`);
    await runInDurableObject(stub, async (_instance: PartyHouse, state) => {
      const rows = state.storage.sql
        .exec<{ session_hash: string; arrival_at: number | null; knock_at: number | null }>(
          "SELECT session_hash, arrival_at, knock_at FROM afterglow_sessions",
        )
        .toArray();
      expect(rows).toHaveLength(2);
      expect(rows.filter(({ knock_at }) => knock_at !== null)).toHaveLength(1);
      expect(rows.some(({ session_hash }) => session_hash === senderWelcome.sessionId)).toBe(false);
      expect(await state.storage.getAlarm()).not.toBeNull();
    });
    expect(afterFirst.afterglow.weights.reduce((sum, value) => sum + value, 0)).toBe(1_000);
  });

  it("caps the visible cohort at twelve and promotes a knocking light", async () => {
    const houses: HouseSocket[] = [];
    const welcomes: Awaited<ReturnType<typeof hello>>[] = [];
    for (let index = 0; index < 13; index += 1) {
      const house = await openHouse();
      houses.push(house);
      welcomes.push(await hello(house));
    }

    const finalWelcome = welcomes.at(-1)!;
    expect(finalWelcome.presenceCount).toBe(13);
    expect(finalWelcome.lights).toHaveLength(12);
    const visibleIds = new Set(finalWelcome.lights.map(({ id }) => id));
    const omittedIndex = welcomes.findIndex(
      ({ self }) => !visibleIds.has(self.id),
    );
    expect(omittedIndex).toBeGreaterThanOrEqual(0);
    const omitted = welcomes[omittedIndex].self;

    await new Promise((resolve) => setTimeout(resolve, 2));
    send(houses[omittedIndex], {
      type: "knock:send",
      requestId: uuid(100),
      zone: 6,
    });
    await expect(
      houses[0].waitFor(
        "house:snapshot",
        (message) =>
          message.presenceCount === 13 &&
          message.lights.some(({ id }) => id === omitted.id),
      ),
    ).resolves.toMatchObject({
      presenceCount: 13,
      lights: expect.arrayContaining([
        expect.objectContaining({ id: omitted.id, zone: 6 }),
      ]),
    });
  });

  it("closes on the third invalid frame and bounds valid message bursts", async () => {
    const invalid = await openHouse();
    await hello(invalid);
    invalid.socket.send("not json");
    await expect(
      invalid.waitFor("error", (message) => !message.fatal),
    ).resolves.toEqual({
      type: "error",
      code: "INVALID_MESSAGE",
      fatal: false,
    });
    invalid.socket.send("{}");
    invalid.socket.send("[]");
    await expect(
      invalid.waitFor("error", (message) => message.fatal),
    ).resolves.toEqual({
      type: "error",
      code: "INVALID_MESSAGE",
      fatal: true,
    });

    const valid = await openHouse();
    await hello(valid);
    // Exact heartbeat frames are answered by the hibernation API without
    // waking the object or consuming the application-message budget.
    for (let index = 0; index < 40; index += 1) send(valid, { type: "ping" });
    await expect
      .poll(() => valid.messages.filter(({ type }) => type === "pong").length)
      .toBe(40);
    expect(valid.messages.some(({ type }) => type === "error")).toBe(false);

    // Hello consumes the first of thirty valid application frames. Unchanged
    // bounded moves are still valid messages, but do not create broadcasts.
    for (let index = 0; index < 29; index += 1) {
      send(valid, {
        type: "light:move",
        zone: 4,
        energy: 0,
        sharing: false,
      });
    }
    send(valid, {
      type: "light:move",
      zone: 4,
      energy: 0,
      sharing: false,
    });
    await expect(
      valid.waitFor("error", (message) => message.fatal),
    ).resolves.toEqual({
      type: "error",
      code: "RATE_LIMITED",
      fatal: true,
    });
  });

  it("admits presence-only sessions but disables moves and KNOCK", async () => {
    const house = await openHouse();
    const stub = env.PARTY_HOUSE.getByName(
      `party-house:${env.PARTY_GENERATION}`,
    );
    await runInDurableObject(stub, async (instance: PartyHouse) => {
      const durableObject = instance as unknown as {
        env: GeneratedPartyEnv;
      };
      const presenceEnv = Object.create(durableObject.env) as GeneratedPartyEnv;
      Object.defineProperty(presenceEnv, "PARTY_HOUSE_MODE", {
        configurable: true,
        enumerable: true,
        value: "presence",
      });
      durableObject.env = presenceEnv;
    });

    await expect(hello(house)).resolves.toMatchObject({ mode: "presence" });
    send(house, { type: "light:move", zone: 1, energy: 1, sharing: true });
    await expect(
      house.waitFor("error", (message) => !message.fatal),
    ).resolves.toEqual({
      type: "error",
      code: "MODE_DISABLED",
      fatal: false,
    });
    send(house, { type: "knock:send", requestId: uuid(200), zone: 1 });
    await expect
      .poll(
        () =>
          house.messages.filter(
            (message) =>
              message.type === "error" && message.code === "MODE_DISABLED",
          ).length,
      )
      .toBe(2);
    expect(house.messages.some(({ type }) => type === "knock")).toBe(false);
  });

  it(
    "rejects the five-hundred-thirteenth concurrent socket",
    async () => {
      const stub = env.PARTY_HOUSE.getByName(
        `party-house:${env.PARTY_GENERATION}`,
      );
      for (let index = 0; index < 512; index += 1) {
        const response = await stub.fetch(houseRequest());
        expect(response.status).toBe(101);
        const socket = response.webSocket;
        if (!socket) throw new Error("Expected a WebSocket upgrade");
        socket.accept();
        openSockets.add(socket);
      }

      const response = await stub.fetch(houseRequest());
      expect(response.status).toBe(101);
      const socket = response.webSocket;
      if (!socket) throw new Error("Expected a WebSocket upgrade");
      socket.accept();
      openSockets.add(socket);
      const messages: PartyHouseServerMessage[] = [];
      socket.addEventListener("message", (event) => {
        const message = parsePartyHouseServerMessageJson(event.data);
        if (message) messages.push(message);
      });
      await expect(
        waitForMessage(socket, messages, "error"),
      ).resolves.toEqual({
        type: "error",
        code: "HOUSE_FULL",
        fatal: true,
      });
    },
    30_000,
  );

  it("cleans expired afterglow via an alarm and reconstructs after eviction", async () => {
    const house = await openHouse();
    const welcome = await hello(house);
    const stub = env.PARTY_HOUSE.getByName(`party-house:${welcome.generation}`);

    await runInDurableObject(stub, async (_instance: PartyHouse, state) => {
      const expiredAt = Date.now() - PARTY_HOUSE_AFTERGLOW_WINDOW_MS - 1;
      state.storage.sql.exec(
        "UPDATE afterglow_sessions SET arrival_at = ?, knock_at = ?",
        expiredAt,
        expiredAt,
      );
      await state.storage.setAlarm(Date.now() + 60_000);
    });
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    await runInDurableObject(stub, async (_instance: PartyHouse, state) => {
      expect(
        state.storage.sql
          .exec<{ count: number }>("SELECT COUNT(*) AS count FROM afterglow_sessions")
          .one().count,
      ).toBe(0);
    });

    await evictDurableObject(stub);
    const reconnect = await openHouse();
    const reconnectWelcome = await hello(reconnect, welcome);
    expect(reconnectWelcome.sessionId).toBe(welcome.sessionId);
    expect(reconnectWelcome.self).toEqual(welcome.self);
    expect(reconnectWelcome.presenceCount).toBe(1);
    expect(reconnectWelcome.afterglow.intensity).toBe(0);
  });
});
