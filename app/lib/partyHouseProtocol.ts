export const PARTY_HOUSE_PROTOCOL_VERSION = 2 as const;
export const PARTY_HOUSE_REALTIME_PATH = "/v2/house" as const;
export const PARTY_HOUSE_REALTIME_SUBPROTOCOL =
  "mistakes-party-house-v2" as const;
export const PARTY_HOUSE_SESSION_STORAGE_KEY =
  "mistakes-party.house.session.v2" as const;
export const PARTY_HOUSE_AFTERGLOW_WINDOW_MS = 86_400_000 as const;

export type PartyHouseZone = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
export type PartyHouseEnergy = 0 | 1 | 2;
export type PartyHouseColor = 0 | 1 | 2 | 3;
export type PartyHouseMode = "presence" | "live";

export type PartyHouseLight = {
  id: string;
  color: PartyHouseColor;
  seed: number;
  zone: PartyHouseZone;
  energy: PartyHouseEnergy;
  sharing: boolean;
};

export type PartyHouseAfterglow = {
  weights: [number, number, number, number];
  intensity: number;
  asOf: number;
  windowMs: typeof PARTY_HOUSE_AFTERGLOW_WINDOW_MS;
};

export type PartyHouseClientMessage =
  | {
      type: "house:hello";
      generation: string | null;
      sessionId: string | null;
    }
  | { type: "ping" }
  | { type: "knock:send"; requestId: string; zone: PartyHouseZone }
  | {
      type: "light:move";
      zone: PartyHouseZone;
      energy: PartyHouseEnergy;
      sharing: boolean;
    };

export type PartyHouseServerMessage =
  | {
      type: "house:welcome";
      protocolVersion: typeof PARTY_HOUSE_PROTOCOL_VERSION;
      generation: string;
      mode: PartyHouseMode;
      sessionId: string;
      self: PartyHouseLight;
      presenceCount: number;
      lights: PartyHouseLight[];
      afterglow: PartyHouseAfterglow;
    }
  | {
      type: "house:snapshot";
      presenceCount: number;
      lights: PartyHouseLight[];
      afterglow: PartyHouseAfterglow;
    }
  | {
      type: "light:move";
      lightId: string;
      zone: PartyHouseZone;
      energy: PartyHouseEnergy;
      sharing: boolean;
    }
  | {
      type: "knock";
      eventId: string;
      requestId: string;
      lightId: string;
      color: PartyHouseColor;
      zone: PartyHouseZone;
      sentAt: number;
    }
  | { type: "pong" }
  | { type: "error"; code: string; fatal: boolean };

const PARTY_HOUSE_CLIENT_MESSAGE_MAX_BYTES = 2_048;
const PARTY_HOUSE_SERVER_MESSAGE_MAX_BYTES = 2_048;
const PARTY_HOUSE_PRESENCE_MAX = 512;
const PARTY_HOUSE_COHORT_MAX = 12;
const PARTY_HOUSE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const PARTY_HOUSE_GENERATION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PARTY_HOUSE_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const UUID_V4_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
): boolean {
  const allowed = new Set(required);
  const keys = Object.keys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    keys.every((key) => allowed.has(key))
  );
}

function isBoundedInteger(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function parseJsonRecord(value: unknown, maximumBytes: number) {
  if (
    typeof value !== "string" ||
    value.length > maximumBytes ||
    new TextEncoder().encode(value).byteLength > maximumBytes
  ) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function isPartyHouseSessionId(value: unknown): value is string {
  return typeof value === "string" && PARTY_HOUSE_ID_PATTERN.test(value);
}

export function isPartyHouseLightId(value: unknown): value is string {
  return typeof value === "string" && PARTY_HOUSE_ID_PATTERN.test(value);
}

export function isPartyHouseGeneration(value: unknown): value is string {
  return (
    typeof value === "string" && PARTY_HOUSE_GENERATION_PATTERN.test(value)
  );
}

export function isPartyHouseRequestId(value: unknown): value is string {
  return typeof value === "string" && UUID_V4_PATTERN.test(value);
}

export function isPartyHouseZone(value: unknown): value is PartyHouseZone {
  return isBoundedInteger(value, 0, 8);
}

export function isPartyHouseEnergy(value: unknown): value is PartyHouseEnergy {
  return isBoundedInteger(value, 0, 2);
}

export function isPartyHouseColor(value: unknown): value is PartyHouseColor {
  return isBoundedInteger(value, 0, 3);
}

function parseLight(value: unknown): PartyHouseLight | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "id",
      "color",
      "seed",
      "zone",
      "energy",
      "sharing",
    ]) ||
    !isPartyHouseLightId(value.id) ||
    !isPartyHouseColor(value.color) ||
    !isBoundedInteger(value.seed, 0, 0xffff_ffff) ||
    !isPartyHouseZone(value.zone) ||
    !isPartyHouseEnergy(value.energy) ||
    typeof value.sharing !== "boolean"
  ) {
    return null;
  }
  return {
    id: value.id,
    color: value.color,
    seed: value.seed,
    zone: value.zone,
    energy: value.energy,
    sharing: value.sharing,
  };
}

function parseLights(value: unknown): PartyHouseLight[] | null {
  if (!Array.isArray(value) || value.length > PARTY_HOUSE_COHORT_MAX) {
    return null;
  }
  const lights: PartyHouseLight[] = [];
  const ids = new Set<string>();
  for (const candidate of value) {
    const light = parseLight(candidate);
    if (!light || ids.has(light.id)) return null;
    ids.add(light.id);
    lights.push(light);
  }
  return lights;
}

function parseAfterglow(value: unknown): PartyHouseAfterglow | null {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["weights", "intensity", "asOf", "windowMs"]) ||
    !Array.isArray(value.weights) ||
    value.weights.length !== 4 ||
    !value.weights.every((weight) => isBoundedInteger(weight, 0, 1_000)) ||
    !isBoundedInteger(value.intensity, 0, 1_000) ||
    !isBoundedInteger(value.asOf, 0, Number.MAX_SAFE_INTEGER) ||
    value.windowMs !== PARTY_HOUSE_AFTERGLOW_WINDOW_MS
  ) {
    return null;
  }
  const weights = value.weights as [number, number, number, number];
  const sum = weights.reduce((total, weight) => total + weight, 0);
  if (sum !== 0 && sum !== 1_000) return null;
  return {
    weights,
    intensity: value.intensity,
    asOf: value.asOf,
    windowMs: PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
  };
}

export function partyHouseRealtimeWebSocketUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  if (
    (url.protocol !== "ws:" && url.protocol !== "wss:") ||
    url.username ||
    url.password
  ) {
    throw new TypeError("Party realtime URL must use HTTP or HTTPS.");
  }
  url.pathname = PARTY_HOUSE_REALTIME_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

export function partyHouseRealtimeWebSocketProtocols(): [
  typeof PARTY_HOUSE_REALTIME_SUBPROTOCOL,
] {
  return [PARTY_HOUSE_REALTIME_SUBPROTOCOL];
}

export function parsePartyHouseClientMessageJson(
  value: unknown,
): PartyHouseClientMessage | null {
  const message = parseJsonRecord(
    value,
    PARTY_HOUSE_CLIENT_MESSAGE_MAX_BYTES,
  );
  if (!message || typeof message.type !== "string") return null;

  switch (message.type) {
    case "house:hello": {
      if (
        !hasExactKeys(message, ["type", "generation", "sessionId"]) ||
        (message.generation !== null &&
          !isPartyHouseGeneration(message.generation)) ||
        (message.sessionId !== null &&
          !isPartyHouseSessionId(message.sessionId)) ||
        ((message.generation === null) !== (message.sessionId === null))
      ) {
        return null;
      }
      return {
        type: "house:hello",
        generation: message.generation,
        sessionId: message.sessionId,
      };
    }
    case "ping":
      return hasExactKeys(message, ["type"]) ? { type: "ping" } : null;
    case "knock:send":
      return hasExactKeys(message, ["type", "requestId", "zone"]) &&
        isPartyHouseRequestId(message.requestId) &&
        isPartyHouseZone(message.zone)
        ? {
            type: "knock:send",
            requestId: message.requestId,
            zone: message.zone,
          }
        : null;
    case "light:move":
      return hasExactKeys(message, ["type", "zone", "energy", "sharing"]) &&
        isPartyHouseZone(message.zone) &&
        isPartyHouseEnergy(message.energy) &&
        typeof message.sharing === "boolean"
        ? {
            type: "light:move",
            zone: message.zone,
            energy: message.energy,
            sharing: message.sharing,
          }
        : null;
    default:
      return null;
  }
}

export function parsePartyHouseServerMessageJson(
  value: unknown,
): PartyHouseServerMessage | null {
  const message = parseJsonRecord(
    value,
    PARTY_HOUSE_SERVER_MESSAGE_MAX_BYTES,
  );
  if (!message || typeof message.type !== "string") return null;

  switch (message.type) {
    case "house:welcome": {
      if (
        !hasExactKeys(message, [
          "type",
          "protocolVersion",
          "generation",
          "mode",
          "sessionId",
          "self",
          "presenceCount",
          "lights",
          "afterglow",
        ]) ||
        message.protocolVersion !== PARTY_HOUSE_PROTOCOL_VERSION ||
        !isPartyHouseGeneration(message.generation) ||
        (message.mode !== "presence" && message.mode !== "live") ||
        !isPartyHouseSessionId(message.sessionId) ||
        !isBoundedInteger(message.presenceCount, 1, PARTY_HOUSE_PRESENCE_MAX)
      ) {
        return null;
      }
      const self = parseLight(message.self);
      const lights = parseLights(message.lights);
      const afterglow = parseAfterglow(message.afterglow);
      return self && lights && afterglow
        ? {
            type: "house:welcome",
            protocolVersion: PARTY_HOUSE_PROTOCOL_VERSION,
            generation: message.generation,
            mode: message.mode,
            sessionId: message.sessionId,
            self,
            presenceCount: message.presenceCount,
            lights,
            afterglow,
          }
        : null;
    }
    case "house:snapshot": {
      if (
        !hasExactKeys(message, [
          "type",
          "presenceCount",
          "lights",
          "afterglow",
        ]) ||
        !isBoundedInteger(message.presenceCount, 0, PARTY_HOUSE_PRESENCE_MAX)
      ) {
        return null;
      }
      const lights = parseLights(message.lights);
      const afterglow = parseAfterglow(message.afterglow);
      return lights && afterglow
        ? {
            type: "house:snapshot",
            presenceCount: message.presenceCount,
            lights,
            afterglow,
          }
        : null;
    }
    case "light:move":
      return hasExactKeys(message, [
        "type",
        "lightId",
        "zone",
        "energy",
        "sharing",
      ]) &&
        isPartyHouseLightId(message.lightId) &&
        isPartyHouseZone(message.zone) &&
        isPartyHouseEnergy(message.energy) &&
        typeof message.sharing === "boolean"
        ? {
            type: "light:move",
            lightId: message.lightId,
            zone: message.zone,
            energy: message.energy,
            sharing: message.sharing,
          }
        : null;
    case "knock":
      return hasExactKeys(message, [
        "type",
        "eventId",
        "requestId",
        "lightId",
        "color",
        "zone",
        "sentAt",
      ]) &&
        isPartyHouseRequestId(message.eventId) &&
        isPartyHouseRequestId(message.requestId) &&
        isPartyHouseLightId(message.lightId) &&
        isPartyHouseColor(message.color) &&
        isPartyHouseZone(message.zone) &&
        isBoundedInteger(message.sentAt, 0, Number.MAX_SAFE_INTEGER)
        ? {
            type: "knock",
            eventId: message.eventId,
            requestId: message.requestId,
            lightId: message.lightId,
            color: message.color,
            zone: message.zone,
            sentAt: message.sentAt,
          }
        : null;
    case "pong":
      return hasExactKeys(message, ["type"]) ? { type: "pong" } : null;
    case "error":
      return hasExactKeys(message, ["type", "code", "fatal"]) &&
        typeof message.code === "string" &&
        PARTY_HOUSE_ERROR_CODE_PATTERN.test(message.code) &&
        typeof message.fatal === "boolean"
        ? { type: "error", code: message.code, fatal: message.fatal }
        : null;
    default:
      return null;
  }
}
