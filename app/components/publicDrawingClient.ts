import type { HighlighterColor } from "./drawingStorage";
import type { NormalizedDrawingBounds } from "../lib/drawingAnchors";

export const PUBLIC_DRAWING_PROTOCOL_VERSION = 2 as const;
export const PUBLIC_DRAWING_SUBPROTOCOL =
  "mistakes-party-drawing-v2" as const;
export const PUBLIC_DRAWING_AUTH_PREFIX = "mistakes-party-public-auth.";
export const PUBLIC_DRAWING_SESSION_KEY =
  "mistakes-party.drawing.public-session.v1";
export const PUBLIC_DRAWING_MEMBERSHIP_KEY =
  "mistakes-party.drawing.public-live.v1";

export type PublicDrawingState =
  | "ambient"
  | "matching"
  | "drawing"
  | "paused"
  | "watching"
  | "offline"
  | "busy";

export type PublicParticipant = {
  id: string;
  name: string;
  color: HighlighterColor;
  drawing: boolean;
};

export type PublicCursor = {
  authorId: string;
  authorName: string;
  anchorSchemaVersion: number;
  anchorId: string;
  x: number;
  y: number;
  color: HighlighterColor;
  visible: boolean;
  seenAt: number;
};

export type PublicAnchoredStroke = {
  version: 2;
  id: string;
  route: string;
  authorId: string;
  authorName: string;
  authorGeneration: number;
  color: HighlighterColor;
  width: number;
  opacity: number;
  createdAt: number;
  anchorSchemaVersion: number;
  anchorId: string;
  points: number[];
  bounds: NormalizedDrawingBounds;
  sequence: number;
  epoch: number;
};

export type PublicPodAssignment = {
  podId: string;
  role: "drawer" | "watcher";
  grant: string;
  expiresAt: number;
};

export type PublicIdentity = {
  id: string;
  name: string;
  token: string;
};

export type PublicMembership = {
  version: 1;
  podId: string;
  route: string;
};

export type PublicPresenceClientMessage =
  | {
      type: "match:request";
      role: "drawer" | "watcher";
      preferredPodId?: string;
    }
  | { type: "match:release"; podId?: string }
  | {
      type: "cursor:move";
      anchorSchemaVersion: number;
      anchorId: string;
      x: number;
      y: number;
      color: HighlighterColor;
      visible: boolean;
    }
  | { type: "ping"; nonce: string };

export type PublicPresenceServerMessage =
  | {
      type: "presence:welcome";
      protocolVersion: 2;
      mode: "presence" | "live";
      generation: string;
      route: string;
      sessionCount: number;
      self: PublicIdentity;
      participants?: PublicParticipant[];
    }
  | { type: "presence:count"; sessionCount: number }
  | ({ type: "cursor:move" } & PublicCursor)
  | { type: "match:assignment"; assignment: PublicPodAssignment }
  | {
      type: "error";
      code: string;
      message: string;
      fatal?: boolean;
      retryAfterMs?: number;
    }
  | { type: "pong"; nonce: string };

export type PublicPodClientMessage =
  | { type: "seat:promote" }
  | { type: "seat:pause" }
  | { type: "seat:release" }
  | {
      type: "stroke:start";
      stroke: Omit<PublicAnchoredStroke, "authorId" | "authorName">;
    }
  | {
      type: "stroke:append";
      strokeId: string;
      anchorId: string;
      anchorSchemaVersion: number;
      sequence: number;
      points: number[];
      bounds: NormalizedDrawingBounds;
      epoch: number;
      authorGeneration: number;
    }
  | {
      type: "stroke:end";
      strokeId: string;
      sequence: number;
      epoch: number;
      authorGeneration: number;
    }
  | {
      type: "cursor:move";
      anchorSchemaVersion: number;
      anchorId: string;
      x: number;
      y: number;
      color: HighlighterColor;
      visible: boolean;
    }
  | { type: "clear:mine" }
  | { type: "ping"; nonce: string };

export type PublicPodServerMessage =
  | {
      type: "pod:welcome";
      protocolVersion: 2;
      podId: string;
      role: "drawer" | "watcher";
      selfId: string;
      selfAuthorGeneration: number;
      epoch: number;
      revision: number;
      participants: PublicParticipant[];
      strokes?: PublicAnchoredStroke[];
      fadeAt?: number | null;
      expiresAt?: number | null;
    }
  | {
      type: "pod:snapshot";
      epoch: number;
      revision: number;
      selfAuthorGeneration: number;
      participants: PublicParticipant[];
      strokes: PublicAnchoredStroke[];
      fadeAt?: number | null;
      expiresAt?: number | null;
    }
  | {
      type: "pod:presence";
      participants: PublicParticipant[];
      revision: number;
    }
  | {
      type: "pod:lifecycle";
      epoch: number;
      revision: number;
      fadeAt: number | null;
      expiresAt: number | null;
    }
  | ({ type: "cursor:move" } & PublicCursor)
  | { type: "stroke:start"; stroke: PublicAnchoredStroke; revision: number }
  | {
      type: "stroke:append";
      authorId: string;
      authorGeneration: number;
      strokeId: string;
      sequence: number;
      points: number[];
      bounds: NormalizedDrawingBounds;
      epoch: number;
      revision: number;
    }
  | {
      type: "stroke:end";
      authorId: string;
      authorGeneration: number;
      strokeId: string;
      sequence: number;
      epoch: number;
      revision: number;
    }
  | {
      type: "strokes:cleared";
      scope: "mine";
      authorId: string;
      authorGeneration: number;
      epoch: number;
      revision: number;
    }
  | {
      type: "pod:expired";
      epoch: number;
      revision: number;
    }
  | {
      type: "error";
      code: string;
      message: string;
      fatal?: boolean;
      retryAfterMs?: number;
    }
  | { type: "pong"; nonce: string };

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replaceAll("-", "_");
  }
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export function readPublicIdentity(): PublicIdentity | null {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(PUBLIC_DRAWING_SESSION_KEY) ?? "null",
    ) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      typeof parsed.id === "string" &&
      "name" in parsed &&
      typeof parsed.name === "string" &&
      "token" in parsed &&
      typeof parsed.token === "string"
    ) {
      return { id: parsed.id, name: parsed.name, token: parsed.token };
    }
  } catch {
    // A fresh identity will be issued by the route lobby.
  }
  return null;
}

export function provisionalPublicIdentity(): PublicIdentity {
  return { id: randomId(), name: "Guest", token: randomId() };
}

export function storePublicIdentity(identity: PublicIdentity): void {
  try {
    window.sessionStorage.setItem(
      PUBLIC_DRAWING_SESSION_KEY,
      JSON.stringify(identity),
    );
  } catch {
    // The identity remains valid for this mounted document.
  }
}

export function readPublicMembership(route: string): PublicMembership | null {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(PUBLIC_DRAWING_MEMBERSHIP_KEY) ?? "null",
    ) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      parsed.version === 1 &&
      "podId" in parsed &&
      typeof parsed.podId === "string" &&
      "route" in parsed &&
      parsed.route === route
    ) {
      return { version: 1, podId: parsed.podId, route: parsed.route };
    }
  } catch {
    // Invalid affinity is ignored and normal matchmaking remains available.
  }
  return null;
}

export function storePublicMembership(membership: PublicMembership): void {
  try {
    window.sessionStorage.setItem(
      PUBLIC_DRAWING_MEMBERSHIP_KEY,
      JSON.stringify(membership),
    );
  } catch {
    // Current pod membership still works without reload affinity.
  }
}

export function clearPublicMembership(): void {
  try {
    window.sessionStorage.removeItem(PUBLIC_DRAWING_MEMBERSHIP_KEY);
  } catch {
    // Membership is still cleared in memory.
  }
}

export function publicWebSocketProtocols(token?: string): string[] {
  return token
    ? [PUBLIC_DRAWING_SUBPROTOCOL, `${PUBLIC_DRAWING_AUTH_PREFIX}${token}`]
    : [PUBLIC_DRAWING_SUBPROTOCOL];
}

function websocketUrl(baseUrl: string, pathname: string): URL {
  const url = new URL(`${baseUrl.replace(/\/$/, "")}${pathname}`);
  if (url.protocol === "http:") url.protocol = "ws:";
  if (url.protocol === "https:") url.protocol = "wss:";
  return url;
}

export function publicPresenceUrl(
  baseUrl: string,
  route: string,
  identity: PublicIdentity | null,
): string {
  const url = websocketUrl(baseUrl, "/v2/public/presence");
  url.searchParams.set("route", route);
  if (identity) {
    url.searchParams.set("sessionId", identity.id);
    url.searchParams.set("name", identity.name);
  }
  return url.toString();
}

export function publicPodUrl(
  baseUrl: string,
  assignment: PublicPodAssignment,
  route: string,
  identity: PublicIdentity,
): string {
  const url = websocketUrl(
    baseUrl,
    `/v2/public/pods/${encodeURIComponent(assignment.podId)}`,
  );
  url.searchParams.set("route", route);
  url.searchParams.set("sessionId", identity.id);
  url.searchParams.set("name", identity.name);
  url.searchParams.set("grant", assignment.grant);
  return url.toString();
}

export function parsePublicMessage<T>(value: unknown): T | null {
  if (typeof value !== "string" || value.length > 16 * 1024 * 1024) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return typeof parsed === "object" &&
      parsed !== null &&
      "type" in parsed &&
      typeof parsed.type === "string"
      ? (parsed as T)
      : null;
  } catch {
    return null;
  }
}
