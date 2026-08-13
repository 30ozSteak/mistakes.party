/**
 * JSON protocol shared by the drawing client and the Cloudflare room worker.
 * Keep this module runtime-neutral: it is imported by browsers, Node tests, and
 * the Workers runtime.
 */

export const DRAWING_REALTIME_PROTOCOL_VERSION = 1 as const;
export const DRAWING_REALTIME_PATH_PREFIX = "/v1/rooms/";
export const DRAWING_REALTIME_ENV_NAME =
  "NEXT_PUBLIC_DRAWING_REALTIME_URL" as const;
export const DRAWING_REALTIME_SUBPROTOCOL =
  "mistakes-party-drawing-v1" as const;
export const DRAWING_REALTIME_AUTH_SUBPROTOCOL_PREFIX =
  "mistakes-party-auth." as const;

export const DRAWING_ROOM_MAX_PARTICIPANTS = 4;
export const DRAWING_ROOM_MAX_SOCKETS = 8;
export const DRAWING_ROOM_MAX_STROKES = 2_000;
export const DRAWING_ROOM_MAX_POINTS_PER_STROKE = 20_000;
export const DRAWING_ROOM_MAX_POINTS_PER_MESSAGE = 512;
export const DRAWING_STROKE_WIDTH = 32;
export const DRAWING_STROKE_OPACITY = 0.45;
export const DRAWING_PARTICIPANT_NAME_MAX_LENGTH = 40;

export const DRAWING_COLORS = [
  "#dfff00",
  "#ff3ea5",
  "#00e5ff",
  "#ff7a00",
] as const;

export type DrawingRealtimeColor = (typeof DRAWING_COLORS)[number];

export interface DrawingBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DrawingRealtimeStroke {
  version: 1;
  id: string;
  route: string;
  color: DrawingRealtimeColor;
  width: number;
  opacity: number;
  createdAt: number;
  points: number[];
  bounds: DrawingBounds;
}

export interface DrawingSharedStroke extends DrawingRealtimeStroke {
  authorId: string;
  authorName: string;
}

export interface DrawingParticipant {
  id: string;
  name: string;
  joinedAt: number;
  connections: number;
  route: string;
}

export type DrawingClientMessage =
  | { type: "route:set"; route: string }
  | { type: "stroke:start"; stroke: DrawingRealtimeStroke }
  | {
      type: "stroke:append";
      route: string;
      strokeId: string;
      points: number[];
      bounds: DrawingBounds;
    }
  | { type: "stroke:end"; route: string; strokeId: string }
  | { type: "clear:mine"; route: string }
  | { type: "room:reset" }
  | {
      type: "cursor:move";
      route: string;
      x: number;
      y: number;
      color: DrawingRealtimeColor;
      visible: boolean;
    }
  | { type: "ping"; nonce: string };

export type DrawingRoomErrorCode =
  | "BAD_REQUEST"
  | "FORBIDDEN_ORIGIN"
  | "ROOM_FULL"
  | "TOO_MANY_CONNECTIONS"
  | "INVALID_MESSAGE"
  | "RATE_LIMITED"
  | "ROOM_LIMIT_REACHED"
  | "NOT_HOST"
  | "STROKE_NOT_FOUND"
  | "SERVER_ERROR";

export type DrawingServerMessage =
  | {
      type: "welcome";
      protocolVersion: typeof DRAWING_REALTIME_PROTOCOL_VERSION;
      roomId: string;
      selfId: string;
      hostId: string;
      participants: DrawingParticipant[];
      route: string;
      strokes: DrawingSharedStroke[];
      revision: number;
    }
  | {
      type: "presence";
      hostId: string;
      participants: DrawingParticipant[];
      revision: number;
    }
  | {
      type: "route:snapshot";
      route: string;
      strokes: DrawingSharedStroke[];
      revision: number;
    }
  | {
      type: "stroke:start";
      stroke: DrawingSharedStroke;
      revision: number;
    }
  | {
      type: "stroke:append";
      route: string;
      strokeId: string;
      authorId: string;
      points: number[];
      bounds: DrawingBounds;
      revision: number;
    }
  | {
      type: "stroke:end";
      route: string;
      strokeId: string;
      authorId: string;
      revision: number;
    }
  | {
      type: "strokes:cleared";
      scope: "mine";
      route: string;
      authorId: string;
      revision: number;
    }
  | {
      type: "room:reset";
      authorId: string;
      revision: number;
    }
  | {
      type: "cursor:move";
      route: string;
      authorId: string;
      authorName: string;
      x: number;
      y: number;
      color: DrawingRealtimeColor;
      visible: boolean;
    }
  | { type: "pong"; nonce: string }
  | {
      type: "error";
      code: DrawingRoomErrorCode;
      message: string;
      fatal?: boolean;
    };

const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const STROKE_ID_PATTERN = /^[A-Za-z0-9:._-]{1,160}$/;
const PARTICIPANT_NAME_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9 '-]{0,38}[A-Za-z0-9])?$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isDrawingRealtimeColor(
  value: unknown,
): value is DrawingRealtimeColor {
  return DRAWING_COLORS.some((color) => color === value);
}

export function normalizeDrawingRoute(value: string): string {
  const pathOnly = value.split(/[?#]/, 1)[0]?.trim() ?? "";
  let route = pathOnly || "/";
  if (!route.startsWith("/")) route = `/${route}`;
  route = route.replace(/\/{2,}/g, "/");
  while (route.length > 1 && route.endsWith("/")) route = route.slice(0, -1);
  return route.slice(0, 512);
}

/**
 * Public lobby routes must be canonical browser pathnames. Private v1 keeps
 * its broader normalization contract for backward compatibility.
 */
export function isPublicDrawingRoute(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= 256 &&
    normalizeDrawingRoute(value) === value &&
    /^\/(?:[A-Za-z0-9._~!$&'()*+,;=:@%-]+\/)*[A-Za-z0-9._~!$&'()*+,;=:@%-]*$/.test(
      value,
    ) &&
    !value.includes("..")
  );
}

export function isDrawingRoomId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isDrawingParticipantId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isDrawingParticipantToken(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

export function isDrawingParticipantName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= DRAWING_PARTICIPANT_NAME_MAX_LENGTH &&
    value === value.trim() &&
    !value.includes("  ") &&
    PARTICIPANT_NAME_PATTERN.test(value)
  );
}

export function normalizeDrawingParticipantName(value: unknown): string {
  if (typeof value !== "string") return "Guest";

  const normalized = value
    .normalize("NFKC")
    .replace(/[^A-Za-z0-9 '-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^['-]+|['-]+$/g, "")
    .trim()
    .slice(0, DRAWING_PARTICIPANT_NAME_MAX_LENGTH)
    .trim()
    .replace(/['-]+$/g, "")
    .trim();

  return isDrawingParticipantName(normalized) ? normalized : "Guest";
}

function drawingWebSocketProtocols(value: unknown): string[] {
  return typeof value === "string"
    ? value
        .split(",")
        .map((protocol) => protocol.trim())
        .filter(Boolean)
    : [];
}

export function hasDrawingRealtimeSubprotocol(value: unknown): boolean {
  return drawingWebSocketProtocols(value).includes(DRAWING_REALTIME_SUBPROTOCOL);
}

export function drawingParticipantTokenFromWebSocketProtocols(
  value: unknown,
): string | null {
  const protocols = drawingWebSocketProtocols(value);
  if (!protocols.includes(DRAWING_REALTIME_SUBPROTOCOL)) return null;

  const credentials = protocols.filter((protocol) =>
    protocol.startsWith(DRAWING_REALTIME_AUTH_SUBPROTOCOL_PREFIX),
  );
  if (credentials.length !== 1) return null;

  const token = credentials[0].slice(
    DRAWING_REALTIME_AUTH_SUBPROTOCOL_PREFIX.length,
  );
  return isDrawingParticipantToken(token) ? token : null;
}

export function drawingRoomWebSocketProtocols(
  participantToken: string,
): [typeof DRAWING_REALTIME_SUBPROTOCOL, string] {
  if (!isDrawingParticipantToken(participantToken)) {
    throw new TypeError("Invalid drawing participant token.");
  }
  return [
    DRAWING_REALTIME_SUBPROTOCOL,
    `${DRAWING_REALTIME_AUTH_SUBPROTOCOL_PREFIX}${participantToken}`,
  ];
}

export function isDrawingStrokeId(value: unknown): value is string {
  return typeof value === "string" && STROKE_ID_PATTERN.test(value);
}

export function isDrawingBounds(value: unknown): value is DrawingBounds {
  if (!isRecord(value)) return false;
  const { minX, minY, maxX, maxY } = value;
  return (
    isFiniteNumber(minX) &&
    isFiniteNumber(minY) &&
    isFiniteNumber(maxX) &&
    isFiniteNumber(maxY) &&
    minX >= 0 &&
    minY >= 0 &&
    minX <= maxX &&
    minY <= maxY &&
    maxX <= 1_000_000 &&
    maxY <= 1_000_000
  );
}

function isPointArray(value: unknown, maximumPoints: number): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length % 2 === 0 &&
    value.length <= maximumPoints * 2 &&
    value.every(
      (coordinate) =>
        isFiniteNumber(coordinate) && coordinate >= 0 && coordinate <= 1_000_000,
    )
  );
}

export function isDrawingRealtimeStroke(
  value: unknown,
): value is DrawingRealtimeStroke {
  if (!isRecord(value)) return false;
  if (
    value.version !== 1 ||
    !isDrawingStrokeId(value.id) ||
    typeof value.route !== "string" ||
    normalizeDrawingRoute(value.route) !== value.route ||
    !isDrawingRealtimeColor(value.color) ||
    value.width !== DRAWING_STROKE_WIDTH ||
    value.opacity !== DRAWING_STROKE_OPACITY ||
    !isFiniteNumber(value.createdAt) ||
    value.createdAt < 0 ||
    !isPointArray(value.points, DRAWING_ROOM_MAX_POINTS_PER_STROKE) ||
    !isDrawingBounds(value.bounds)
  ) {
    return false;
  }

  for (let index = 0; index < value.points.length; index += 2) {
    const x = value.points[index];
    const y = value.points[index + 1];
    if (
      x < value.bounds.minX ||
      x > value.bounds.maxX ||
      y < value.bounds.minY ||
      y > value.bounds.maxY
    ) {
      return false;
    }
  }
  return true;
}

export function parseDrawingClientMessage(
  value: unknown,
): DrawingClientMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;

  switch (value.type) {
    case "route:set":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route
        ? { type: value.type, route: value.route }
        : null;
    case "stroke:start":
      return isDrawingRealtimeStroke(value.stroke)
        ? { type: value.type, stroke: value.stroke }
        : null;
    case "stroke:append":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        isDrawingStrokeId(value.strokeId) &&
        isPointArray(value.points, DRAWING_ROOM_MAX_POINTS_PER_MESSAGE) &&
        isDrawingBounds(value.bounds)
        ? {
            type: value.type,
            route: value.route,
            strokeId: value.strokeId,
            points: value.points,
            bounds: value.bounds,
          }
        : null;
    case "stroke:end":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        isDrawingStrokeId(value.strokeId)
        ? { type: value.type, route: value.route, strokeId: value.strokeId }
        : null;
    case "clear:mine":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route
        ? { type: value.type, route: value.route }
        : null;
    case "room:reset":
      return { type: value.type };
    case "cursor:move":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        value.x >= 0 &&
        value.y >= 0 &&
        value.x <= 1_000_000 &&
        value.y <= 1_000_000 &&
        isDrawingRealtimeColor(value.color) &&
        typeof value.visible === "boolean"
        ? {
            type: value.type,
            route: value.route,
            x: value.x,
            y: value.y,
            color: value.color,
            visible: value.visible,
          }
        : null;
    case "ping":
      return typeof value.nonce === "string" && value.nonce.length <= 128
        ? { type: value.type, nonce: value.nonce }
        : null;
    default:
      return null;
  }
}

export function parseDrawingClientMessageJson(
  value: string,
): DrawingClientMessage | null {
  if (value.length > 64 * 1024) return null;
  try {
    return parseDrawingClientMessage(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function isDrawingParticipant(value: unknown): value is DrawingParticipant {
  return (
    isRecord(value) &&
    isDrawingParticipantId(value.id) &&
    isDrawingParticipantName(value.name) &&
    isFiniteNumber(value.joinedAt) &&
    value.joinedAt >= 0 &&
    typeof value.connections === "number" &&
    Number.isInteger(value.connections) &&
    value.connections >= 1 &&
    value.connections <= DRAWING_ROOM_MAX_SOCKETS &&
    typeof value.route === "string" &&
    normalizeDrawingRoute(value.route) === value.route
  );
}

function isDrawingSharedStroke(value: unknown): value is DrawingSharedStroke {
  return (
    isDrawingRealtimeStroke(value) &&
    isRecord(value) &&
    isDrawingParticipantId(value.authorId) &&
    isDrawingParticipantName(value.authorName)
  );
}

function isRevision(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isErrorCode(value: unknown): value is DrawingRoomErrorCode {
  return (
    typeof value === "string" &&
    [
      "BAD_REQUEST",
      "FORBIDDEN_ORIGIN",
      "ROOM_FULL",
      "TOO_MANY_CONNECTIONS",
      "INVALID_MESSAGE",
      "RATE_LIMITED",
      "ROOM_LIMIT_REACHED",
      "NOT_HOST",
      "STROKE_NOT_FOUND",
      "SERVER_ERROR",
    ].includes(value)
  );
}

export function parseDrawingServerMessage(
  value: unknown,
): DrawingServerMessage | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  const participants = (candidate: unknown) =>
    Array.isArray(candidate) && candidate.every(isDrawingParticipant);
  const strokes = (candidate: unknown) =>
    Array.isArray(candidate) && candidate.every(isDrawingSharedStroke);

  switch (value.type) {
    case "welcome":
      return value.protocolVersion === DRAWING_REALTIME_PROTOCOL_VERSION &&
        isDrawingRoomId(value.roomId) &&
        isDrawingParticipantId(value.selfId) &&
        isDrawingParticipantId(value.hostId) &&
        participants(value.participants) &&
        typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        strokes(value.strokes) &&
        isRevision(value.revision)
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "presence":
      return isDrawingParticipantId(value.hostId) &&
        participants(value.participants) &&
        isRevision(value.revision)
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "route:snapshot":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        strokes(value.strokes) &&
        isRevision(value.revision)
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "stroke:start":
      return isDrawingSharedStroke(value.stroke) && isRevision(value.revision)
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "stroke:append":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        isDrawingStrokeId(value.strokeId) &&
        isDrawingParticipantId(value.authorId) &&
        isPointArray(value.points, DRAWING_ROOM_MAX_POINTS_PER_MESSAGE) &&
        isDrawingBounds(value.bounds) &&
        isRevision(value.revision)
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "stroke:end":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        isDrawingStrokeId(value.strokeId) &&
        isDrawingParticipantId(value.authorId) &&
        isRevision(value.revision)
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "strokes:cleared":
      return value.scope === "mine" &&
        typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        isDrawingParticipantId(value.authorId) &&
        isRevision(value.revision)
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "room:reset":
      return isDrawingParticipantId(value.authorId) &&
        isRevision(value.revision)
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "cursor:move":
      return typeof value.route === "string" &&
        normalizeDrawingRoute(value.route) === value.route &&
        isDrawingParticipantId(value.authorId) &&
        isDrawingParticipantName(value.authorName) &&
        isFiniteNumber(value.x) &&
        isFiniteNumber(value.y) &&
        value.x >= 0 &&
        value.y >= 0 &&
        value.x <= 1_000_000 &&
        value.y <= 1_000_000 &&
        isDrawingRealtimeColor(value.color) &&
        typeof value.visible === "boolean"
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "pong":
      return typeof value.nonce === "string" && value.nonce.length <= 128
        ? (value as unknown as DrawingServerMessage)
        : null;
    case "error":
      return isErrorCode(value.code) &&
        typeof value.message === "string" &&
        value.message.length > 0 &&
        value.message.length <= 500 &&
        (value.fatal === undefined || typeof value.fatal === "boolean")
        ? (value as unknown as DrawingServerMessage)
        : null;
    default:
      return null;
  }
}

export function parseDrawingServerMessageJson(
  value: string,
): DrawingServerMessage | null {
  // A route snapshot may contain the room's entire 200k-point allowance.
  // This remains below Cloudflare's 32 MiB WebSocket frame limit while keeping
  // malformed/unbounded frames out of JSON.parse.
  if (value.length > 16 * 1024 * 1024) return null;
  try {
    return parseDrawingServerMessage(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

export function createDrawingRoomId(): string {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export function drawingRoomWebSocketUrl(
  baseUrl: string,
  roomId: string,
  participantId: string,
  name: string,
  route: string,
): string {
  if (
    !isDrawingRoomId(roomId) ||
    !isDrawingParticipantId(participantId)
  ) {
    throw new TypeError("Invalid drawing room or participant ID.");
  }
  const url = new URL(
    `${baseUrl.replace(/\/$/, "")}${DRAWING_REALTIME_PATH_PREFIX}${roomId}`,
  );
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  url.searchParams.set("participantId", participantId);
  url.searchParams.set("name", normalizeDrawingParticipantName(name));
  url.searchParams.set("route", normalizeDrawingRoute(route));
  return url.toString();
}
