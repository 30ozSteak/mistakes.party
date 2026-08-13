export const PARTY_PROTOCOL_VERSION = 1 as const;
export const PARTY_REALTIME_PATH = "/v1/party" as const;
export const PARTY_REALTIME_SUBPROTOCOL =
  "mistakes-party-presence-v1" as const;
export const PARTY_SESSION_STORAGE_KEY =
  "mistakes-party.presence.session.v1" as const;

export const PARTY_SIGNAL_KINDS = [
  "cheers",
  "hi",
  "bad_idea",
  "i_was_here",
] as const;

export type PartySignalKind = (typeof PARTY_SIGNAL_KINDS)[number];

export const PARTY_SIGNAL_LABELS = {
  cheers: "CHEERS",
  hi: "HI",
  bad_idea: "BAD IDEA",
  i_was_here: "I WAS HERE",
} as const satisfies Record<PartySignalKind, string>;

export type PartyClientMessage =
  | { type: "signal:send"; kind: PartySignalKind }
  | { type: "ping" };

export type PartyServerMessage =
  | {
      type: "welcome";
      protocolVersion: typeof PARTY_PROTOCOL_VERSION;
      generation: string;
      route: string;
      sessionId: string;
      presenceCount: number;
    }
  | { type: "presence"; presenceCount: number }
  | {
      type: "signal";
      id: string;
      kind: PartySignalKind;
      sentAt: number;
    }
  | {
      type: "error";
      code: string;
      message: string;
      fatal?: boolean;
      retryAfterMs?: number;
    }
  | { type: "pong" };

const PARTY_ROUTE_MAX_LENGTH = 256;
const PARTY_PRESENCE_MAX = 256;
const PARTY_CLIENT_MESSAGE_MAX_BYTES = 512;
const PARTY_SERVER_MESSAGE_MAX_BYTES = 2_048;
const PARTY_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const PARTY_SIGNAL_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PARTY_GENERATION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const PARTY_ERROR_CODE_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/;
const PARTY_ROUTE_PATTERN =
  /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/)*[A-Za-z0-9._~!$&'()*+,;=:@%-]*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
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

export function normalizePartyRoute(value: string): string {
  const pathOnly = value.split(/[?#]/, 1)[0]?.trim() ?? "";
  let route = pathOnly || "/";
  if (!route.startsWith("/")) route = `/${route}`;
  route = route.replace(/\/{2,}/g, "/");
  while (route.length > 1 && route.endsWith("/")) route = route.slice(0, -1);
  return route.slice(0, PARTY_ROUTE_MAX_LENGTH);
}

export function isPartyRoute(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > PARTY_ROUTE_MAX_LENGTH ||
    normalizePartyRoute(value) !== value ||
    !PARTY_ROUTE_PATTERN.test(value)
  ) {
    return false;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return false;
  }

  if (decoded.includes("\\") || decoded.includes("..")) return false;
  const decodedLower = decoded.toLowerCase();
  return decodedLower !== "/patreon" && !decodedLower.startsWith("/patreon/");
}

export function isPartySessionId(value: unknown): value is string {
  return typeof value === "string" && PARTY_ID_PATTERN.test(value);
}

export function isPartySignalKind(value: unknown): value is PartySignalKind {
  return PARTY_SIGNAL_KINDS.some((kind) => kind === value);
}

export function partyRealtimeWebSocketUrl(
  baseUrl: string,
  route: string,
  sessionId?: string | null,
): string {
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
  url.pathname = PARTY_REALTIME_PATH;
  url.search = "";
  url.hash = "";
  url.searchParams.set("route", normalizePartyRoute(route));
  if (isPartySessionId(sessionId)) url.searchParams.set("sessionId", sessionId);
  return url.toString();
}

export function partyRealtimeWebSocketProtocols(): [
  typeof PARTY_REALTIME_SUBPROTOCOL,
] {
  return [PARTY_REALTIME_SUBPROTOCOL];
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

export function parsePartyClientMessageJson(
  value: unknown,
): PartyClientMessage | null {
  const message = parseJsonRecord(value, PARTY_CLIENT_MESSAGE_MAX_BYTES);
  if (!message || typeof message.type !== "string") return null;

  if (message.type === "ping") {
    return hasExactKeys(message, ["type"]) ? { type: "ping" } : null;
  }
  if (
    message.type === "signal:send" &&
    hasExactKeys(message, ["type", "kind"]) &&
    isPartySignalKind(message.kind)
  ) {
    return { type: "signal:send", kind: message.kind };
  }
  return null;
}

export function parsePartyServerMessageJson(
  value: unknown,
): PartyServerMessage | null {
  const message = parseJsonRecord(value, PARTY_SERVER_MESSAGE_MAX_BYTES);
  if (!message || typeof message.type !== "string") return null;

  switch (message.type) {
    case "welcome":
      return hasExactKeys(message, [
        "type",
        "protocolVersion",
        "generation",
        "route",
        "sessionId",
        "presenceCount",
      ]) &&
        message.protocolVersion === PARTY_PROTOCOL_VERSION &&
        typeof message.generation === "string" &&
        PARTY_GENERATION_PATTERN.test(message.generation) &&
        isPartyRoute(message.route) &&
        isPartySessionId(message.sessionId) &&
        isBoundedInteger(message.presenceCount, 0, PARTY_PRESENCE_MAX)
        ? {
            type: "welcome",
            protocolVersion: PARTY_PROTOCOL_VERSION,
            generation: message.generation,
            route: message.route,
            sessionId: message.sessionId,
            presenceCount: message.presenceCount,
          }
        : null;
    case "presence":
      return hasExactKeys(message, ["type", "presenceCount"]) &&
        isBoundedInteger(message.presenceCount, 0, PARTY_PRESENCE_MAX)
        ? { type: "presence", presenceCount: message.presenceCount }
        : null;
    case "signal":
      return hasExactKeys(message, ["type", "id", "kind", "sentAt"]) &&
        typeof message.id === "string" &&
        PARTY_SIGNAL_ID_PATTERN.test(message.id) &&
        isPartySignalKind(message.kind) &&
        isBoundedInteger(message.sentAt, 0, Number.MAX_SAFE_INTEGER)
        ? {
            type: "signal",
            id: message.id,
            kind: message.kind,
            sentAt: message.sentAt,
          }
        : null;
    case "error": {
      if (
        !hasExactKeys(
          message,
          ["type", "code", "message"],
          ["fatal", "retryAfterMs"],
        ) ||
        typeof message.code !== "string" ||
        !PARTY_ERROR_CODE_PATTERN.test(message.code) ||
        typeof message.message !== "string" ||
        message.message.length < 1 ||
        message.message.length > 200 ||
        (message.fatal !== undefined && typeof message.fatal !== "boolean") ||
        (message.retryAfterMs !== undefined &&
          !isBoundedInteger(message.retryAfterMs, 0, 60_000))
      ) {
        return null;
      }
      return {
        type: "error",
        code: message.code,
        message: message.message,
        ...(message.fatal === undefined ? {} : { fatal: message.fatal }),
        ...(message.retryAfterMs === undefined
          ? {}
          : { retryAfterMs: message.retryAfterMs }),
      };
    }
    case "pong":
      return hasExactKeys(message, ["type"]) ? { type: "pong" } : null;
    default:
      return null;
  }
}
