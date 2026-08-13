import { DurableObject } from "cloudflare:workers";

import {
  DRAWING_COLORS,
  DRAWING_STROKE_OPACITY,
  DRAWING_STROKE_WIDTH,
  isPublicDrawingRoute,
  normalizeDrawingParticipantName,
} from "../../app/lib/drawingRealtimeProtocol";

export const PUBLIC_DRAWING_SUBPROTOCOL = "mistakes-party-drawing-v2";
export const PUBLIC_DRAWING_AUTH_PREFIX = "mistakes-party-public-auth.";
export const PUBLIC_PRESENCE_PATH = "/v2/public/presence";
export const PUBLIC_POD_PATH_PREFIX = "/v2/public/pods/";

const PUBLIC_PROTOCOL_VERSION = 2;
const ANCHOR_SCHEMA_VERSION = 1;
const MAX_DRAWERS = 4;
const MAX_PODS = 8;
const MAX_WATCHERS = 32;
const MAX_AMBIENT_SOCKETS = 256;
const MAX_STROKES = 500;
const MAX_TOTAL_POINTS = 50_000;
const MAX_POINTS_PER_STROKE = 20_000;
const MAX_POINTS_PER_APPEND = 512;
const MAX_MESSAGES_PER_SECOND = 120;
const MAX_MESSAGE_BYTES = 128 * 1024;
const DEFAULT_GRANT_MS = 15_000;
const DEFAULT_SEAT_HOLD_MS = 120_000;
const DEFAULT_AFTERGLOW_MS = 600_000;
const DEFAULT_FADE_MS = 60_000;
const MAX_LOBBY_IDENTITIES = 2_048;
const MAX_PENDING_GRANTS = MAX_DRAWERS + MAX_WATCHERS;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const POD_ID_PATTERN = /^[A-Za-z0-9_-]{12,128}$/;
const STROKE_ID_PATTERN = /^[A-Za-z0-9:._-]{1,160}$/;

export type PublicMode = "off" | "presence" | "live";
type PublicRole = "drawer" | "watcher";
type PodSocketRole = PublicRole | "paused";

export interface PublicDrawingEnv {
  PUBLIC_ROUTE_LOBBIES: DurableObjectNamespace<PublicRouteLobby>;
  PUBLIC_DRAWING_PODS: DurableObjectNamespace<PublicDrawingPod>;
  PUBLIC_DRAWING_MODE?: string;
  PUBLIC_DRAWING_GENERATION?: string;
  PUBLIC_GRANT_MS?: string;
  PUBLIC_SEAT_HOLD_MS?: string;
  PUBLIC_AFTERGLOW_MS?: string;
  PUBLIC_FADE_MS?: string;
}

interface NormalizedBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface PublicIdentity {
  id: string;
  name: string;
  token: string;
}

interface PublicParticipant {
  id: string;
  name: string;
  color: (typeof DRAWING_COLORS)[number];
  drawing: boolean;
}

interface PublicStroke {
  version: 2;
  id: string;
  route: string;
  authorId: string;
  authorName: string;
  authorGeneration: number;
  color: (typeof DRAWING_COLORS)[number];
  width: number;
  opacity: number;
  createdAt: number;
  anchorSchemaVersion: number;
  anchorId: string;
  points: number[];
  bounds: NormalizedBounds;
  sequence: number;
  epoch: number;
}

interface LobbyAttachment {
  version: 2;
  sessionId: string;
  name: string;
  token: string;
  route: string;
  generation: string;
  canPreview: boolean;
  cursor: PublicCursorState | null;
  pendingAssignment: PodGrant | null;
  activePodId: string | null;
  rateStartedAt: number;
  rateCount: number;
}

interface PodAttachment {
  version: 2;
  sessionId: string;
  name: string;
  color: (typeof DRAWING_COLORS)[number];
  route: string;
  generation: string;
  role: PodSocketRole;
  authorGeneration: number;
  pausedUntil: number | null;
  cursor: PublicCursorState | null;
  lobbyName: string;
  rateStartedAt: number;
  rateCount: number;
}

interface PodStats {
  podId: string;
  drawers: number;
  paused: number;
  watchers: number;
  lastActivityAt: number;
  expiresAt: number | null;
  drawerAvailable: boolean;
  watcherAvailable: boolean;
}

interface PodGrant {
  podId: string;
  role: PublicRole;
  grant: string;
  expiresAt: number;
}

interface PodMetaRow {
  [key: string]: string | number | null;
  epoch: number;
  revision: number;
  total_points: number;
  last_activity_at: number;
  expires_at: number | null;
  fade_at: number | null;
  route: string;
  generation: string;
  pod_id: string;
  lobby_name: string;
}

interface StrokeRow {
  [key: string]: string | number;
  id: string;
  author_id: string;
  author_name: string;
  author_generation: number;
  route: string;
  color: (typeof DRAWING_COLORS)[number];
  width: number;
  opacity: number;
  created_at: number;
  anchor_schema_version: number;
  anchor_id: string;
  bounds_json: string;
  sequence: number;
  epoch: number;
  ended: number;
}

interface PublicCursorState {
  anchorId: string;
  x: number;
  y: number;
  color: (typeof DRAWING_COLORS)[number];
  visible: boolean;
  seenAt: number;
}

function configuredMilliseconds(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed)
    ? Math.max(minimum, Math.min(maximum, parsed))
    : fallback;
}

export function publicDrawingMode(env: PublicDrawingEnv): PublicMode {
  return env.PUBLIC_DRAWING_MODE === "off" ||
    env.PUBLIC_DRAWING_MODE === "presence" ||
    env.PUBLIC_DRAWING_MODE === "live"
    ? env.PUBLIC_DRAWING_MODE
    : "off";
}

export function publicDrawingGeneration(env: PublicDrawingEnv): string {
  const value = (env.PUBLIC_DRAWING_GENERATION ?? "v1").trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(value) ? value : "v1";
}

function routeLobbyName(generation: string, route: string): string {
  return `public-route:${generation}:${route}`;
}

function podObjectName(generation: string, route: string, podId: string): string {
  return `public-pod:${generation}:${route}:${podId}`;
}

function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "_");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isColor(value: unknown): value is (typeof DRAWING_COLORS)[number] {
  return DRAWING_COLORS.some((color) => color === value);
}

function isNormalizedCoordinate(value: unknown): value is number {
  return isFiniteNumber(value) && value >= 0 && value <= 1;
}

function isNormalizedPoints(value: unknown, maximum = MAX_POINTS_PER_APPEND): value is number[] {
  return (
    Array.isArray(value) &&
    value.length >= 2 &&
    value.length % 2 === 0 &&
    value.length / 2 <= maximum &&
    value.every(isNormalizedCoordinate)
  );
}

function isBounds(value: unknown): value is NormalizedBounds {
  return (
    isRecord(value) &&
    isNormalizedCoordinate(value.minX) &&
    isNormalizedCoordinate(value.minY) &&
    isNormalizedCoordinate(value.maxX) &&
    isNormalizedCoordinate(value.maxY) &&
    value.minX <= value.maxX &&
    value.minY <= value.maxY
  );
}

function boundsForPoints(points: readonly number[]): NormalizedBounds {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (let index = 0; index < points.length; index += 2) {
    minX = Math.min(minX, points[index]);
    minY = Math.min(minY, points[index + 1]);
    maxX = Math.max(maxX, points[index]);
    maxY = Math.max(maxY, points[index + 1]);
  }
  return { minX, minY, maxX, maxY };
}

function mergeBounds(left: NormalizedBounds, right: NormalizedBounds): NormalizedBounds {
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY),
  };
}

function validAnchor(anchorId: unknown, schema: unknown): anchorId is string {
  return (
    schema === ANCHOR_SCHEMA_VERSION &&
    typeof anchorId === "string" &&
    anchorId.length > 0 &&
    anchorId.length <= 160 &&
    /^[A-Za-z0-9:._-]+$/.test(anchorId)
  );
}

function parseJsonMessage(data: string | ArrayBuffer): Record<string, unknown> | null {
  if (typeof data !== "string" || data.length > MAX_MESSAGE_BYTES) return null;
  try {
    const parsed: unknown = JSON.parse(data);
    return isRecord(parsed) && typeof parsed.type === "string" ? parsed : null;
  } catch {
    return null;
  }
}

function protocols(header: string | null): string[] {
  return (header ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function hasPublicDrawingProtocol(header: string | null): boolean {
  return protocols(header).includes(PUBLIC_DRAWING_SUBPROTOCOL);
}

function publicToken(header: string | null): string | null {
  const value = protocols(header).find((entry) =>
    entry.startsWith(PUBLIC_DRAWING_AUTH_PREFIX),
  );
  const token = value?.slice(PUBLIC_DRAWING_AUTH_PREFIX.length) ?? null;
  return token && ID_PATTERN.test(token) ? token : null;
}

function send(socket: WebSocket, message: unknown): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // A socket may close between enumeration and send.
  }
}

function aggregateLog(event: string, details: Record<string, number | string> = {}): void {
  console.log(JSON.stringify({ event, ...details }));
}

function closeWithError(
  socket: WebSocket,
  code: string,
  message: string,
  fatal = false,
): void {
  send(socket, { type: "error", code, message, fatal: fatal || undefined });
  if (fatal) {
    try {
      socket.close(1008, code);
    } catch {
      // Already closed.
    }
  }
}

function activeSockets(ctx: DurableObjectState): WebSocket[] {
  return ctx.getWebSockets().filter((socket) => socket.readyState === WebSocket.OPEN);
}

function lobbyAttachment(socket: WebSocket): LobbyAttachment | null {
  try {
    const value = socket.deserializeAttachment() as LobbyAttachment | null;
    return value?.version === 2 && ID_PATTERN.test(value.sessionId) ? value : null;
  } catch {
    return null;
  }
}

function podAttachment(socket: WebSocket): PodAttachment | null {
  try {
    const value = socket.deserializeAttachment() as PodAttachment | null;
    return value?.version === 2 && ID_PATTERN.test(value.sessionId) ? value : null;
  } catch {
    return null;
  }
}

function rateAllowed<T extends LobbyAttachment | PodAttachment>(
  socket: WebSocket,
  attachment: T,
): boolean {
  const now = Date.now();
  if (now - attachment.rateStartedAt >= 1_000) {
    attachment.rateStartedAt = now;
    attachment.rateCount = 0;
  }
  attachment.rateCount += 1;
  socket.serializeAttachment(attachment);
  return attachment.rateCount <= MAX_MESSAGES_PER_SECOND;
}

function participantColor(sessionId: string): (typeof DRAWING_COLORS)[number] {
  let hash = 0;
  for (const character of sessionId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return DRAWING_COLORS[Math.abs(hash) % DRAWING_COLORS.length];
}

function fatalConfigurationError(
  socket: WebSocket,
  attachmentGeneration: string,
  env: PublicDrawingEnv,
  requireLive: boolean,
): boolean {
  const mode = publicDrawingMode(env);
  if (attachmentGeneration !== publicDrawingGeneration(env)) {
    closeWithError(socket, "GENERATION_CHANGED", "This public drawing generation has ended.", true);
    return true;
  }
  if (mode === "off" || (requireLive && mode !== "live")) {
    closeWithError(
      socket,
      mode === "off" ? "PUBLIC_DISABLED" : "LIVE_DISABLED",
      mode === "off" ? "Public drawing is disabled." : "Live drawing is currently unavailable.",
      true,
    );
    return true;
  }
  return false;
}

export class PublicRouteLobby extends DurableObject<PublicDrawingEnv> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: PublicDrawingEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS identities (
          session_id TEXT PRIMARY KEY,
          token TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS pods (
          pod_id TEXT PRIMARY KEY,
          created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS affinities (
          session_id TEXT PRIMARY KEY,
          pod_id TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS active_memberships (
          session_id TEXT PRIMARY KEY,
          pod_id TEXT NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private ensureConfig(route: string, generation: string): boolean {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS lobby_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      INSERT OR IGNORE INTO lobby_config (key, value) VALUES ('route', ?), ('generation', ?);
    `, route, generation);
    const config = new Map(
      this.ctx.storage.sql
        .exec<{ key: string; value: string }>("SELECT key, value FROM lobby_config")
        .toArray()
        .map((row) => [row.key, row.value]),
    );
    return config.get("route") === route && config.get("generation") === generation;
  }

  private sessionCount(): number {
    return activeSockets(this.ctx).filter((socket) => lobbyAttachment(socket) !== null).length;
  }

  private pruneIdentities(): void {
    const rows = this.ctx.storage.sql
      .exec<{ session_id: string }>(
        "SELECT session_id FROM identities ORDER BY created_at DESC",
      )
      .toArray();
    if (rows.length < MAX_LOBBY_IDENTITIES) return;
    const active = new Set(
      activeSockets(this.ctx)
        .map(lobbyAttachment)
        .filter((value): value is LobbyAttachment => value !== null)
        .map((value) => value.sessionId),
    );
    for (const { session_id: sessionId } of this.ctx.storage.sql
      .exec<{ session_id: string }>("SELECT session_id FROM active_memberships")
      .toArray()) {
      active.add(sessionId);
    }
    for (const { session_id: sessionId } of rows.slice(MAX_LOBBY_IDENTITIES - 1).reverse()) {
      if (active.has(sessionId)) continue;
      this.ctx.storage.sql.exec("DELETE FROM active_memberships WHERE session_id = ?", sessionId);
      this.ctx.storage.sql.exec("DELETE FROM affinities WHERE session_id = ?", sessionId);
      this.ctx.storage.sql.exec("DELETE FROM identities WHERE session_id = ?", sessionId);
    }
  }

  private broadcast(message: unknown, except?: WebSocket): void {
    for (const socket of activeSockets(this.ctx)) {
      if (socket !== except && lobbyAttachment(socket)) send(socket, message);
    }
  }

  private broadcastCount(): void {
    this.broadcast({ type: "presence:count", sessionCount: this.sessionCount() });
  }

  async fetch(request: Request): Promise<Response> {
    return this.exclusive(async () => {
      const url = new URL(request.url);
      const rawRoute = url.searchParams.get("route");
      if (!isPublicDrawingRoute(rawRoute)) {
        return new Response("Invalid public route", { status: 400 });
      }
      const route = rawRoute;
      const generation = publicDrawingGeneration(this.env);
      if (!this.ensureConfig(route, generation)) {
        return new Response("Public route assignment mismatch", { status: 409 });
      }

      if (publicDrawingMode(this.env) === "off") {
        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
        const sessionId = randomId();
        server.serializeAttachment({
          version: 2,
          sessionId,
          name: "Guest",
          token: randomId(),
          route,
          generation,
          canPreview: false,
          cursor: null,
          pendingAssignment: null,
          activePodId: null,
          rateStartedAt: Date.now(),
          rateCount: 0,
        } satisfies LobbyAttachment);
        this.ctx.acceptWebSocket(server);
        closeWithError(server, "PUBLIC_DISABLED", "Public drawing is disabled.", true);
        return new Response(null, {
          status: 101,
          webSocket: client,
          headers: { "sec-websocket-protocol": PUBLIC_DRAWING_SUBPROTOCOL },
        });
      }

      if (activeSockets(this.ctx).length >= MAX_AMBIENT_SOCKETS) {
        return new Response("Route presence is full", { status: 429 });
      }

      const requestedId = url.searchParams.get("sessionId");
      const requestedToken = publicToken(request.headers.get("sec-websocket-protocol"));
      let identity: PublicIdentity;
      this.pruneIdentities();
      if (requestedId) {
        if (!ID_PATTERN.test(requestedId) || !requestedToken) {
          return new Response("Invalid public identity", { status: 401 });
        }
        const stored = this.ctx.storage.sql
          .exec<{ session_id: string; token: string; name: string }>(
            "SELECT session_id, token, name FROM identities WHERE session_id = ?",
            requestedId,
          )
          .toArray()[0];
        if (stored && stored.token !== requestedToken) {
          return new Response("Invalid public identity", { status: 401 });
        }
        if (stored) {
          identity = { id: stored.session_id, name: stored.name, token: stored.token };
          this.ctx.storage.sql.exec(
            "UPDATE identities SET created_at = ? WHERE session_id = ?",
            Date.now(),
            identity.id,
          );
        } else {
          identity = {
            id: requestedId,
            token: requestedToken,
            name: normalizeDrawingParticipantName(url.searchParams.get("name")),
          };
          this.ctx.storage.sql.exec(
            "INSERT INTO identities (session_id, token, name, created_at) VALUES (?, ?, ?, ?)",
            identity.id,
            identity.token,
            identity.name,
            Date.now(),
          );
        }
      } else {
        identity = {
          id: randomId(),
          token: randomId(),
          name: normalizeDrawingParticipantName(url.searchParams.get("name")),
        };
        if (identity.name === "Guest") {
          const adjectives = ["Acid", "Electric", "Hot", "Wonky", "Neon", "Lucky"];
          const creatures = ["Moth", "Pigeon", "Possum", "Snail", "Goblin", "Raccoon"];
          identity.name = `${adjectives[Math.floor(Math.random() * adjectives.length)]} ${creatures[Math.floor(Math.random() * creatures.length)]}`;
        }
        this.ctx.storage.sql.exec(
          "INSERT INTO identities (session_id, token, name, created_at) VALUES (?, ?, ?, ?)",
          identity.id,
          identity.token,
          identity.name,
          Date.now(),
        );
      }

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      const attachment: LobbyAttachment = {
        version: 2,
        sessionId: identity.id,
        name: identity.name,
        token: identity.token,
        route,
        generation,
        canPreview: false,
        cursor: null,
        pendingAssignment: null,
        activePodId: null,
        rateStartedAt: Date.now(),
        rateCount: 0,
      };
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server, [`session:${identity.id}`]);
      const mode = publicDrawingMode(this.env);
      send(server, {
        type: "presence:welcome",
        protocolVersion: PUBLIC_PROTOCOL_VERSION,
        mode: mode === "live" ? "live" : "presence",
        generation,
        route,
        sessionCount: this.sessionCount(),
        self: identity,
      });
      this.broadcastCount();
      aggregateLog("public_presence_connected", { sessionCount: this.sessionCount() });

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "sec-websocket-protocol": PUBLIC_DRAWING_SUBPROTOCOL },
      });
    });
  }

  async setSessionPod(
    sessionId: string,
    podId: string,
    drawing: boolean,
    connected: boolean,
  ): Promise<void> {
    if (connected) {
      this.ctx.storage.sql.exec(
        `INSERT INTO active_memberships (session_id, pod_id, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(session_id) DO UPDATE SET
           pod_id = excluded.pod_id, updated_at = excluded.updated_at`,
        sessionId,
        podId,
        Date.now(),
      );
    }
    for (const socket of this.ctx.getWebSockets(`session:${sessionId}`)) {
      const attachment = lobbyAttachment(socket);
      if (!attachment) continue;
      attachment.pendingAssignment = null;
      if (connected) {
        attachment.activePodId = podId;
      } else if (attachment.activePodId === podId) {
        attachment.activePodId = null;
      }
      attachment.canPreview = drawing && publicDrawingMode(this.env) === "live";
      if (!attachment.canPreview) this.broadcastCursorRemoval(attachment, socket);
      socket.serializeAttachment(attachment);
    }
    if (!connected) {
      this.ctx.storage.sql.exec(
        "DELETE FROM active_memberships WHERE session_id = ? AND pod_id = ?",
        sessionId,
        podId,
      );
    }
  }

  private async sessionIsActiveInPod(
    attachment: LobbyAttachment,
    podId: string,
  ): Promise<boolean | null> {
    try {
      return await this.env.PUBLIC_DRAWING_PODS.getByName(
        podObjectName(attachment.generation, attachment.route, podId),
      ).hasSession(attachment.sessionId);
    } catch {
      return null;
    }
  }

  private broadcastCursorRemoval(attachment: LobbyAttachment, except?: WebSocket): void {
    const cursor = attachment.cursor;
    if (!cursor?.visible) return;
    attachment.cursor = { ...cursor, visible: false, seenAt: Date.now() };
    this.broadcast(
      {
        type: "cursor:move",
        authorId: attachment.sessionId,
        authorName: attachment.name,
        anchorSchemaVersion: ANCHOR_SCHEMA_VERSION,
        ...attachment.cursor,
      },
      except,
    );
  }

  private async requestMatch(
    socket: WebSocket,
    attachment: LobbyAttachment,
    role: PublicRole,
  ): Promise<void> {
    if (publicDrawingMode(this.env) !== "live") {
      closeWithError(socket, "LIVE_DISABLED", "Live drawing is currently watch-only.");
      return;
    }
    for (const sibling of this.ctx.getWebSockets(`session:${attachment.sessionId}`)) {
      const siblingAttachment = lobbyAttachment(sibling);
      if (!siblingAttachment || sibling === socket) continue;
      if (
        siblingAttachment.pendingAssignment &&
        siblingAttachment.pendingAssignment.expiresAt > Date.now()
      ) {
        attachment.pendingAssignment = siblingAttachment.pendingAssignment;
        socket.serializeAttachment(attachment);
        send(socket, {
          type: "match:assignment",
          assignment: siblingAttachment.pendingAssignment,
        });
        return;
      }
      if (siblingAttachment.activePodId) {
        closeWithError(socket, "ALREADY_MATCHED", "This session is already in a public pod.");
        return;
      }
    }
    if (
      attachment.pendingAssignment &&
      attachment.pendingAssignment.expiresAt > Date.now()
    ) {
      send(socket, {
        type: "match:assignment",
        assignment: attachment.pendingAssignment,
      });
      return;
    }
    if (attachment.activePodId) {
      closeWithError(socket, "ALREADY_MATCHED", "This session is already in a public pod.");
      return;
    }
    attachment.pendingAssignment = null;

    const generation = publicDrawingGeneration(this.env);
    const lobbyName = routeLobbyName(generation, attachment.route);
    const activeMembership = this.ctx.storage.sql
      .exec<{ pod_id: string }>(
        "SELECT pod_id FROM active_memberships WHERE session_id = ?",
        attachment.sessionId,
      )
      .toArray()[0]?.pod_id;
    if (activeMembership) {
      const active = await this.sessionIsActiveInPod(attachment, activeMembership);
      if (active === null) {
        closeWithError(socket, "LIVE_BUSY", "Your previous public pod is still reconnecting.");
        return;
      }
      if (active) {
        attachment.activePodId = activeMembership;
        socket.serializeAttachment(attachment);
        closeWithError(socket, "ALREADY_MATCHED", "This session is already in a public pod.");
        return;
      }
      const matchingAffinity = this.ctx.storage.sql
        .exec<{ pod_id: string }>(
          "SELECT pod_id FROM affinities WHERE session_id = ?",
          attachment.sessionId,
        )
        .toArray()[0]?.pod_id;
      if (matchingAffinity !== activeMembership) {
        closeWithError(socket, "LIVE_BUSY", "Your previous public pod is still disconnecting.");
        return;
      }
      this.ctx.storage.sql.exec(
        "DELETE FROM active_memberships WHERE session_id = ? AND pod_id = ?",
        attachment.sessionId,
        activeMembership,
      );
    }
    const podRows = this.ctx.storage.sql
      .exec<{ pod_id: string; created_at: number }>(
        "SELECT pod_id, created_at FROM pods ORDER BY created_at ASC LIMIT ?",
        MAX_PODS,
      )
      .toArray();

    const storedPreferred = this.ctx.storage.sql
      .exec<{ pod_id: string }>("SELECT pod_id FROM affinities WHERE session_id = ?", attachment.sessionId)
      .toArray()[0]?.pod_id;
    // A client may echo the server-issued membership, but it cannot select an
    // arbitrary raw pod. The persisted lobby affinity is authoritative.
    const preferredPodId = storedPreferred;
    if (preferredPodId) {
      const active = await this.sessionIsActiveInPod(attachment, preferredPodId);
      if (active === null) {
        closeWithError(socket, "LIVE_BUSY", "Your previous public pod is still reconnecting.");
        return;
      }
      if (active) {
        this.ctx.storage.sql.exec(
          `INSERT INTO active_memberships (session_id, pod_id, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET
             pod_id = excluded.pod_id, updated_at = excluded.updated_at`,
          attachment.sessionId,
          preferredPodId,
          Date.now(),
        );
        attachment.activePodId = preferredPodId;
        socket.serializeAttachment(attachment);
        closeWithError(socket, "ALREADY_MATCHED", "This session is already in a public pod.");
        return;
      }
    }
    const candidates = (await Promise.all(
      podRows.map(async ({ pod_id: podId, created_at: createdAt }) => {
        const stub = this.env.PUBLIC_DRAWING_PODS.getByName(
          podObjectName(generation, attachment.route, podId),
        );
        try {
          return { stub, createdAt, stats: await stub.stats(podId) };
        } catch {
          return null;
        }
      }),
    )).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);
    candidates.sort(
      (left, right) =>
        Number(right.stats.podId === preferredPodId) - Number(left.stats.podId === preferredPodId) ||
        right.stats.drawers - left.stats.drawers ||
        right.stats.lastActivityAt - left.stats.lastActivityAt ||
        left.createdAt - right.createdAt,
    );
    let attempts = 0;
    for (const candidate of candidates) {
      if (role === "drawer" ? !candidate.stats.drawerAvailable : !candidate.stats.watcherAvailable) continue;
      if (attempts >= 3) break;
      attempts += 1;
      let grant: PodGrant | null = null;
      try {
        grant = await candidate.stub.reserve({
          podId: candidate.stats.podId,
          route: attachment.route,
          generation,
          lobbyName,
          sessionId: attachment.sessionId,
          token: attachment.token,
          name: attachment.name,
          role,
        });
      } catch {
        continue;
      }
      if (grant) {
        for (const sibling of this.ctx.getWebSockets(`session:${attachment.sessionId}`)) {
          const siblingAttachment = lobbyAttachment(sibling);
          if (!siblingAttachment) continue;
          siblingAttachment.pendingAssignment = grant;
          sibling.serializeAttachment(siblingAttachment);
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO affinities (session_id, pod_id, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET pod_id = excluded.pod_id, updated_at = excluded.updated_at`,
          attachment.sessionId,
          grant.podId,
          Date.now(),
        );
        send(socket, { type: "match:assignment", assignment: grant });
        aggregateLog("public_match_assigned", {
          role,
          drawers: candidate.stats.drawers,
          watchers: candidate.stats.watchers,
        });
        return;
      }
    }

    if (podRows.length < MAX_PODS) {
      const podId = `pod_${randomId()}`;
      this.ctx.storage.sql.exec(
        "INSERT INTO pods (pod_id, created_at) VALUES (?, ?)",
        podId,
        Date.now(),
      );
      const stub = this.env.PUBLIC_DRAWING_PODS.getByName(
        podObjectName(generation, attachment.route, podId),
      );
      let grant: PodGrant | null = null;
      try {
        grant = await stub.reserve({
          podId,
          route: attachment.route,
          generation,
          lobbyName,
          sessionId: attachment.sessionId,
          token: attachment.token,
          name: attachment.name,
          role,
        });
      } catch {
        grant = null;
      }
      if (grant) {
        for (const sibling of this.ctx.getWebSockets(`session:${attachment.sessionId}`)) {
          const siblingAttachment = lobbyAttachment(sibling);
          if (!siblingAttachment) continue;
          siblingAttachment.pendingAssignment = grant;
          sibling.serializeAttachment(siblingAttachment);
        }
        this.ctx.storage.sql.exec(
          `INSERT INTO affinities (session_id, pod_id, updated_at) VALUES (?, ?, ?)
           ON CONFLICT(session_id) DO UPDATE SET pod_id = excluded.pod_id, updated_at = excluded.updated_at`,
          attachment.sessionId,
          grant.podId,
          Date.now(),
        );
        send(socket, { type: "match:assignment", assignment: grant });
        aggregateLog("public_match_pod_created", { role, podCount: podRows.length + 1 });
        return;
      }
    }

    closeWithError(socket, "LIVE_BUSY", "Every public drawing pod is busy.");
    aggregateLog("public_match_busy", { podCount: podRows.length, role });
  }

  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    return this.exclusive(async () => {
      const attachment = lobbyAttachment(socket);
      if (!attachment) return;
      if (fatalConfigurationError(socket, attachment.generation, this.env, false)) return;
      if (!rateAllowed(socket, attachment)) {
        closeWithError(socket, "RATE_LIMITED", "Presence updates are arriving too quickly.");
        return;
      }
      const message = parseJsonMessage(data);
      if (!message) {
        closeWithError(socket, "INVALID_MESSAGE", "The presence message is invalid.");
        return;
      }
      if (message.type === "ping" && typeof message.nonce === "string") {
        send(socket, { type: "pong", nonce: message.nonce.slice(0, 80) });
        return;
      }
      if (
        message.type === "match:request" &&
        (message.role === "drawer" || message.role === "watcher")
      ) {
        await this.requestMatch(
          socket,
          attachment,
          message.role,
        );
        return;
      }
      if (message.type === "match:release") {
        this.broadcastCursorRemoval(attachment, socket);
        attachment.canPreview = false;
        const pending = attachment.pendingAssignment;
        for (const sibling of this.ctx.getWebSockets(`session:${attachment.sessionId}`)) {
          const siblingAttachment = lobbyAttachment(sibling);
          if (!siblingAttachment) continue;
          siblingAttachment.pendingAssignment = null;
          sibling.serializeAttachment(siblingAttachment);
        }
        if (pending) {
          try {
            await this.env.PUBLIC_DRAWING_PODS.getByName(
              podObjectName(attachment.generation, attachment.route, pending.podId),
            ).cancelReservation(attachment.sessionId, attachment.token);
          } catch {
            // Expired reservations are pruned by the pod alarm.
          }
        }
        return;
      }
      if (
        message.type === "cursor:move" &&
        attachment.canPreview &&
        validAnchor(message.anchorId, message.anchorSchemaVersion) &&
        isNormalizedCoordinate(message.x) &&
        isNormalizedCoordinate(message.y) &&
        isColor(message.color) &&
        typeof message.visible === "boolean"
      ) {
        const now = Date.now();
        if (message.visible && attachment.cursor && now - attachment.cursor.seenAt < 100) return;
        attachment.cursor = {
          anchorId: message.anchorId,
          x: message.x,
          y: message.y,
          color: message.color,
          visible: message.visible,
          seenAt: now,
        };
        socket.serializeAttachment(attachment);
        this.broadcast(
          {
            type: "cursor:move",
            authorId: attachment.sessionId,
            authorName: attachment.name,
            anchorSchemaVersion: ANCHOR_SCHEMA_VERSION,
            anchorId: message.anchorId,
            x: message.x,
            y: message.y,
            color: message.color,
            visible: message.visible,
            seenAt: now,
          },
          socket,
        );
        return;
      }
      closeWithError(socket, "INVALID_MESSAGE", "The presence message is invalid.");
    });
  }

  webSocketClose(socket: WebSocket): void {
    const attachment = lobbyAttachment(socket);
    if (attachment) this.broadcastCursorRemoval(attachment, socket);
    this.broadcastCount();
    aggregateLog("public_presence_disconnected", { sessionCount: this.sessionCount() });
  }

  webSocketError(socket: WebSocket): void {
    const attachment = lobbyAttachment(socket);
    if (attachment) this.broadcastCursorRemoval(attachment, socket);
    this.broadcastCount();
  }
}

type ReserveInput = {
  podId: string;
  route: string;
  generation: string;
  lobbyName: string;
  sessionId: string;
  token: string;
  name: string;
  role: PublicRole;
};

export class PublicDrawingPod extends DurableObject<PublicDrawingEnv> {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: PublicDrawingEnv) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS pod_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          epoch INTEGER NOT NULL,
          revision INTEGER NOT NULL,
          total_points INTEGER NOT NULL,
          last_activity_at INTEGER NOT NULL,
          expires_at INTEGER,
          fade_at INTEGER,
          route TEXT NOT NULL,
          generation TEXT NOT NULL,
          pod_id TEXT NOT NULL,
          lobby_name TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS grants (
          grant_id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          token TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT NOT NULL,
          expires_at INTEGER NOT NULL,
          used INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS strokes (
          id TEXT NOT NULL,
          author_id TEXT NOT NULL,
          author_name TEXT NOT NULL,
          route TEXT NOT NULL,
          color TEXT NOT NULL,
          width REAL NOT NULL,
          opacity REAL NOT NULL,
          created_at INTEGER NOT NULL,
          anchor_schema_version INTEGER NOT NULL,
          anchor_id TEXT NOT NULL,
          bounds_json TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          epoch INTEGER NOT NULL,
          author_generation INTEGER NOT NULL,
          ended INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (id, author_id, author_generation)
        );
        CREATE TABLE IF NOT EXISTS stroke_chunks (
          stroke_id TEXT NOT NULL,
          author_id TEXT NOT NULL,
          author_generation INTEGER NOT NULL,
          sequence INTEGER NOT NULL,
          points_json TEXT NOT NULL,
          PRIMARY KEY (stroke_id, author_id, author_generation, sequence)
        );
        CREATE TABLE IF NOT EXISTS author_generations (
          author_id TEXT PRIMARY KEY,
          generation INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_strokes_author ON strokes(author_id);
      `);
    });
  }

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.queue.then(operation, operation);
    this.queue = result.catch(() => undefined);
    return result;
  }

  private grantMilliseconds(): number {
    return configuredMilliseconds(this.env.PUBLIC_GRANT_MS, DEFAULT_GRANT_MS, 250, 60_000);
  }

  private seatHoldMilliseconds(): number {
    return configuredMilliseconds(this.env.PUBLIC_SEAT_HOLD_MS, DEFAULT_SEAT_HOLD_MS, 1_000, 10 * 60_000);
  }

  private afterglowMilliseconds(): number {
    return configuredMilliseconds(this.env.PUBLIC_AFTERGLOW_MS, DEFAULT_AFTERGLOW_MS, 1_000, 60 * 60_000);
  }

  private fadeMilliseconds(): number {
    return configuredMilliseconds(this.env.PUBLIC_FADE_MS, DEFAULT_FADE_MS, 0, 10 * 60_000);
  }

  private meta(): PodMetaRow | null {
    return this.ctx.storage.sql.exec<PodMetaRow>("SELECT * FROM pod_meta WHERE singleton = 1").toArray()[0] ?? null;
  }

  private sockets(): Array<{ socket: WebSocket; attachment: PodAttachment }> {
    return activeSockets(this.ctx)
      .map((socket) => ({ socket, attachment: podAttachment(socket) }))
      .filter(
        (entry): entry is { socket: WebSocket; attachment: PodAttachment } =>
          entry.attachment !== null,
      );
  }

  private uniqueRoles(): Map<string, PodSocketRole> {
    const roles = new Map<string, PodSocketRole>();
    for (const { attachment } of this.sockets()) {
      const current = roles.get(attachment.sessionId);
      if (current === "drawer") continue;
      if (attachment.role === "drawer" || current === undefined) {
        roles.set(attachment.sessionId, attachment.role);
      } else if (attachment.role === "paused" && current === "watcher") {
        roles.set(attachment.sessionId, "paused");
      }
    }
    return roles;
  }

  private pruneGrants(now = Date.now()): void {
    this.ctx.storage.sql.exec("DELETE FROM grants WHERE used != 0 OR expires_at <= ?", now);
  }

  private pendingRoles(): Map<string, PublicRole> {
    this.pruneGrants();
    return new Map(
      this.ctx.storage.sql
        .exec<{ session_id: string; role: PublicRole }>(
          "SELECT session_id, role FROM grants ORDER BY expires_at DESC",
        )
        .toArray()
        .map((row) => [row.session_id, row.role]),
    );
  }

  private nextAuthorGeneration(authorId: string): number {
    this.ctx.storage.sql.exec(
      "INSERT OR IGNORE INTO author_generations (author_id, generation) VALUES (?, 0)",
      authorId,
    );
    this.ctx.storage.sql.exec(
      "UPDATE author_generations SET generation = generation + 1 WHERE author_id = ?",
      authorId,
    );
    return this.ctx.storage.sql
      .exec<{ generation: number }>(
        "SELECT generation FROM author_generations WHERE author_id = ?",
        authorId,
      )
      .one().generation;
  }

  private isCurrentAuthorGeneration(attachment: PodAttachment): boolean {
    return this.ctx.storage.sql
      .exec<{ generation: number }>(
        "SELECT generation FROM author_generations WHERE author_id = ?",
        attachment.sessionId,
      )
      .toArray()[0]?.generation === attachment.authorGeneration;
  }

  private participants(): PublicParticipant[] {
    const byId = new Map<string, PublicParticipant>();
    for (const { attachment } of this.sockets()) {
      const current = byId.get(attachment.sessionId);
      const drawing = attachment.role === "drawer";
      if (!current) {
        byId.set(attachment.sessionId, {
          id: attachment.sessionId,
          name: attachment.name,
          color: attachment.color,
          drawing,
        });
      } else if (drawing) {
        current.drawing = true;
      }
    }
    return [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  }

  async hasSession(sessionId: string): Promise<boolean> {
    return this.exclusive(async () =>
      ID_PATTERN.test(sessionId) && this.uniqueRoles().has(sessionId),
    );
  }

  async stats(fallbackPodId: string): Promise<PodStats> {
    return this.exclusive(async () => {
      const roles = this.uniqueRoles();
      const pending = this.pendingRoles();
      for (const sessionId of roles.keys()) pending.delete(sessionId);
      const drawerSeats = [...roles.values()].filter(
        (role) => role === "drawer" || role === "paused",
      ).length + [...pending.values()].filter((role) => role === "drawer").length;
      const watchers = [...roles.values()].filter((role) => role === "watcher").length +
        [...pending.values()].filter((role) => role === "watcher").length;
      const meta = this.meta();
      const strokeCount = meta
        ? this.ctx.storage.sql
            .exec<{ count: number }>(
              "SELECT COUNT(*) AS count FROM strokes WHERE epoch = ?",
              meta.epoch,
            )
            .one().count
        : 0;
      return {
        podId: meta?.pod_id ?? fallbackPodId,
        drawers: [...roles.values()].filter((role) => role === "drawer").length,
        paused: [...roles.values()].filter((role) => role === "paused").length,
        watchers: [...roles.values()].filter((role) => role === "watcher").length,
        lastActivityAt: meta?.last_activity_at ?? 0,
        expiresAt: meta?.expires_at ?? null,
        drawerAvailable:
          drawerSeats < MAX_DRAWERS &&
          (meta?.total_points ?? 0) < MAX_TOTAL_POINTS &&
          strokeCount < MAX_STROKES,
        watcherAvailable: watchers < MAX_WATCHERS,
      };
    });
  }

  async reserve(input: ReserveInput): Promise<PodGrant | null> {
    return this.exclusive(async () => {
      if (
        publicDrawingMode(this.env) !== "live" ||
        input.generation !== publicDrawingGeneration(this.env) ||
        !POD_ID_PATTERN.test(input.podId) ||
        !ID_PATTERN.test(input.sessionId) ||
        !ID_PATTERN.test(input.token)
      ) {
        return null;
      }
      this.pruneGrants();
      const roles = this.uniqueRoles();
      if (roles.has(input.sessionId)) return null;
      const existingGrant = this.ctx.storage.sql
        .exec<{
          grant_id: string;
          token: string;
          role: PublicRole;
          expires_at: number;
        }>(
          "SELECT grant_id, token, role, expires_at FROM grants WHERE session_id = ? ORDER BY expires_at DESC LIMIT 1",
          input.sessionId,
        )
        .toArray()[0];
      if (existingGrant?.token === input.token && existingGrant.role === input.role) {
        return {
          podId: input.podId,
          role: input.role,
          grant: existingGrant.grant_id,
          expiresAt: existingGrant.expires_at,
        };
      }
      this.ctx.storage.sql.exec("DELETE FROM grants WHERE session_id = ?", input.sessionId);
      const pending = this.pendingRoles();
      for (const sessionId of roles.keys()) pending.delete(sessionId);
      const drawerSeats = [...roles.values()].filter(
        (role) => role === "drawer" || role === "paused",
      ).length + [...pending.values()].filter((role) => role === "drawer").length;
      const watchers = [...roles.values()].filter((role) => role === "watcher").length +
        [...pending.values()].filter((role) => role === "watcher").length;
      if (
        pending.size >= MAX_PENDING_GRANTS ||
        (input.role === "drawer" && drawerSeats >= MAX_DRAWERS) ||
        (input.role === "watcher" && watchers >= MAX_WATCHERS)
      ) {
        return null;
      }

      const existingMeta = this.meta();
      if (!existingMeta) {
        this.ctx.storage.sql.exec(
          `INSERT INTO pod_meta
            (singleton, epoch, revision, total_points, last_activity_at, expires_at, fade_at, route, generation, pod_id, lobby_name)
           VALUES (1, 1, 0, 0, ?, NULL, NULL, ?, ?, ?, ?)`,
          Date.now(),
          input.route,
          input.generation,
          input.podId,
          input.lobbyName,
        );
      } else if (
        existingMeta.route !== input.route ||
        existingMeta.generation !== input.generation ||
        existingMeta.pod_id !== input.podId
      ) {
        return null;
      }
      const meta = this.meta();
      if (input.role === "drawer" && meta) {
        const strokeCount = this.ctx.storage.sql
          .exec<{ count: number }>(
            "SELECT COUNT(*) AS count FROM strokes WHERE epoch = ?",
            meta.epoch,
          )
          .one().count;
        if (meta.total_points >= MAX_TOTAL_POINTS || strokeCount >= MAX_STROKES) return null;
      }

      const grant = randomId();
      const expiresAt = Date.now() + this.grantMilliseconds();
      this.ctx.storage.sql.exec(
        `INSERT INTO grants (grant_id, session_id, token, name, role, expires_at, used)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        grant,
        input.sessionId,
        input.token,
        normalizeDrawingParticipantName(input.name),
        input.role,
        expiresAt,
      );
      await this.scheduleAlarm();
      return { podId: input.podId, role: input.role, grant, expiresAt };
    });
  }

  async cancelReservation(sessionId: string, token: string): Promise<void> {
    await this.exclusive(async () => {
      if (!ID_PATTERN.test(sessionId) || !ID_PATTERN.test(token)) return;
      this.ctx.storage.sql.exec(
        "DELETE FROM grants WHERE session_id = ? AND token = ?",
        sessionId,
        token,
      );
      await this.scheduleAlarm();
    });
  }

  private publicStrokes(meta: PodMetaRow): PublicStroke[] {
    const strokes = this.ctx.storage.sql
      .exec<StrokeRow>(
        "SELECT * FROM strokes WHERE epoch = ? ORDER BY created_at ASC, id ASC",
        meta.epoch,
      )
      .toArray();
    const chunksByStroke = new Map<string, string[]>();
    const chunks = this.ctx.storage.sql
      .exec<{
        stroke_id: string;
        author_id: string;
        author_generation: number;
        points_json: string;
      }>(
        `SELECT c.stroke_id, c.author_id, c.author_generation, c.points_json
         FROM stroke_chunks c
         INNER JOIN strokes s
           ON s.id = c.stroke_id
          AND s.author_id = c.author_id
          AND s.author_generation = c.author_generation
         WHERE s.epoch = ?
         ORDER BY s.created_at ASC, s.id ASC, c.sequence ASC`,
        meta.epoch,
      )
      .toArray();
    for (const chunk of chunks) {
      const key = `${chunk.author_id}\u0000${chunk.author_generation}\u0000${chunk.stroke_id}`;
      const values = chunksByStroke.get(key) ?? [];
      values.push(chunk.points_json);
      chunksByStroke.set(key, values);
    }
    return strokes.flatMap((row) => {
      let bounds: NormalizedBounds;
      try {
        const parsed: unknown = JSON.parse(row.bounds_json);
        if (!isBounds(parsed)) return [];
        bounds = parsed;
      } catch {
        return [];
      }
      const points: number[] = [];
      const key = `${row.author_id}\u0000${row.author_generation}\u0000${row.id}`;
      for (const pointsJson of chunksByStroke.get(key) ?? []) {
        try {
          const parsed: unknown = JSON.parse(pointsJson);
          if (!isNormalizedPoints(parsed, MAX_POINTS_PER_STROKE)) return [];
          points.push(...parsed);
        } catch {
          return [];
        }
      }
      if (points.length < 2 || points.length / 2 > MAX_POINTS_PER_STROKE) return [];
      return [{
        version: 2 as const,
        id: row.id,
        route: row.route,
        authorId: row.author_id,
        authorName: row.author_name,
        authorGeneration: row.author_generation,
        color: row.color,
        width: row.width,
        opacity: row.opacity,
        createdAt: row.created_at,
        anchorSchemaVersion: row.anchor_schema_version,
        anchorId: row.anchor_id,
        points,
        bounds,
        sequence: row.sequence,
        epoch: row.epoch,
      }];
    });
  }

  private broadcast(message: unknown, except?: WebSocket): void {
    for (const { socket } of this.sockets()) {
      if (socket !== except) send(socket, message);
    }
  }

  private broadcastPresence(meta: PodMetaRow): void {
    meta.revision += 1;
    meta.last_activity_at = Date.now();
    this.writeMeta(meta);
    this.broadcast({
      type: "pod:presence",
      participants: this.participants(),
      revision: meta.revision,
    });
  }

  private broadcastLifecycle(meta: PodMetaRow): void {
    this.broadcast({
      type: "pod:lifecycle",
      epoch: meta.epoch,
      revision: meta.revision,
      fadeAt: meta.fade_at,
      expiresAt: meta.expires_at,
    });
  }

  private writeMeta(meta: PodMetaRow): void {
    this.ctx.storage.sql.exec(
      `UPDATE pod_meta SET epoch = ?, revision = ?, total_points = ?,
       last_activity_at = ?, expires_at = ?, fade_at = ?, route = ?, generation = ?, pod_id = ?, lobby_name = ?
       WHERE singleton = 1`,
      meta.epoch,
      meta.revision,
      meta.total_points,
      meta.last_activity_at,
      meta.expires_at,
      meta.fade_at,
      meta.route,
      meta.generation,
      meta.pod_id,
      meta.lobby_name,
    );
  }

  private notifyLobby(
    sessionId: string,
    drawing: boolean,
    connected = true,
  ): void {
    const meta = this.meta();
    if (!meta) return;
    this.ctx.waitUntil(
      this.env.PUBLIC_ROUTE_LOBBIES.getByName(meta.lobby_name).setSessionPod(
        sessionId,
        meta.pod_id,
        drawing,
        connected,
      ).catch(() => {
        // Membership is also verified against this pod before lobby fallback.
      }),
    );
  }

  async fetch(request: Request): Promise<Response> {
    return this.exclusive(async () => {
      const url = new URL(request.url);
      const podId = decodeURIComponent(url.pathname.slice(PUBLIC_POD_PATH_PREFIX.length));
      const sessionId = url.searchParams.get("sessionId") ?? "";
      const token = publicToken(request.headers.get("sec-websocket-protocol"));
      const grantId = url.searchParams.get("grant") ?? "";
      const rawRoute = url.searchParams.get("route");
      if (!isPublicDrawingRoute(rawRoute)) {
        return new Response("Invalid public route", { status: 400 });
      }
      const route = rawRoute;
      if (!POD_ID_PATTERN.test(podId) || !ID_PATTERN.test(sessionId) || !token || !ID_PATTERN.test(grantId)) {
        return new Response("Invalid pod admission", { status: 400 });
      }
      const grant = this.ctx.storage.sql
        .exec<{
          grant_id: string;
          session_id: string;
          token: string;
          name: string;
          role: PublicRole;
          expires_at: number;
          used: number;
        }>("SELECT * FROM grants WHERE grant_id = ?", grantId)
        .toArray()[0];
      if (
        !grant ||
        grant.used !== 0 ||
        grant.expires_at < Date.now() ||
        grant.session_id !== sessionId ||
        grant.token !== token
      ) {
        return new Response("Pod grant expired", { status: 401 });
      }

      const roles = this.uniqueRoles();
      if (roles.has(sessionId)) {
        this.ctx.storage.sql.exec("DELETE FROM grants WHERE grant_id = ?", grantId);
        return new Response("A pod connection already exists for this session", { status: 409 });
      }
      const pending = this.pendingRoles();
      for (const activeSessionId of roles.keys()) pending.delete(activeSessionId);
      const seats = [...roles.values()].filter((role) => role === "drawer" || role === "paused").length +
        [...pending.values()].filter((role) => role === "drawer").length;
      const watchers = [...roles.values()].filter((role) => role === "watcher").length +
        [...pending.values()].filter((role) => role === "watcher").length;
      if (
        (grant.role === "drawer" && seats > MAX_DRAWERS) ||
        (grant.role === "watcher" && watchers > MAX_WATCHERS)
      ) {
        this.ctx.storage.sql.exec("DELETE FROM grants WHERE grant_id = ?", grantId);
        return new Response("Pod capacity changed", { status: 409 });
      }

      const meta = this.meta();
      if (
        !meta ||
        meta.pod_id !== podId ||
        meta.route !== route ||
        meta.generation !== publicDrawingGeneration(this.env)
      ) {
        return new Response("Pod assignment mismatch", { status: 409 });
      }
      this.ctx.storage.sql.exec("DELETE FROM grants WHERE grant_id = ?", grantId);
      if (grant.role === "drawer") {
        const lifecycleChanged = meta.expires_at !== null || meta.fade_at !== null;
        meta.expires_at = null;
        meta.fade_at = null;
        if (lifecycleChanged) {
          meta.revision += 1;
          meta.last_activity_at = Date.now();
        }
        this.writeMeta(meta);
        if (lifecycleChanged) this.broadcastLifecycle(meta);
      }
      const authorGeneration = this.nextAuthorGeneration(sessionId);

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      const attachment: PodAttachment = {
        version: 2,
        sessionId,
        name: grant.name,
        color: participantColor(sessionId),
        route,
        generation: meta.generation,
        role: grant.role,
        authorGeneration,
        pausedUntil: null,
        cursor: null,
        lobbyName: meta.lobby_name,
        rateStartedAt: Date.now(),
        rateCount: 0,
      };
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server, [`session:${sessionId}`]);
      meta.revision += 1;
      meta.last_activity_at = Date.now();
      this.writeMeta(meta);
      const participants = this.participants();
      send(server, {
        type: "pod:welcome",
        protocolVersion: PUBLIC_PROTOCOL_VERSION,
        podId,
        role: grant.role,
        selfId: sessionId,
        selfAuthorGeneration: authorGeneration,
        epoch: meta.epoch,
        revision: meta.revision,
        participants,
        strokes: this.publicStrokes(meta),
        fadeAt: meta.fade_at,
        expiresAt: meta.expires_at,
      });
      this.broadcast(
        { type: "pod:presence", participants, revision: meta.revision },
        server,
      );
      await this.notifyLobby(sessionId, grant.role === "drawer");
      aggregateLog("public_pod_connected", {
        drawers: participants.filter((participant) => participant.drawing).length,
        participants: participants.length,
      });
      await this.scheduleAlarm();

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "sec-websocket-protocol": PUBLIC_DRAWING_SUBPROTOCOL },
      });
    });
  }

  private activeStroke(
    authorId: string,
    authorGeneration: number,
    strokeId: string,
  ): StrokeRow | null {
    return this.ctx.storage.sql
      .exec<StrokeRow>(
        "SELECT * FROM strokes WHERE id = ? AND author_id = ? AND author_generation = ?",
        strokeId,
        authorId,
        authorGeneration,
      )
      .toArray()[0] ?? null;
  }

  private validStrokeStart(
    value: unknown,
    meta: PodMetaRow,
    authorGeneration: number,
  ): value is Omit<PublicStroke, "authorId" | "authorName"> {
    if (!isRecord(value)) return false;
    return (
      value.version === 2 &&
      typeof value.id === "string" &&
      STROKE_ID_PATTERN.test(value.id) &&
      value.route === meta.route &&
      isColor(value.color) &&
      value.width === DRAWING_STROKE_WIDTH &&
      value.opacity === DRAWING_STROKE_OPACITY &&
      isFiniteNumber(value.createdAt) &&
      validAnchor(value.anchorId, value.anchorSchemaVersion) &&
      isNormalizedPoints(value.points) &&
      isBounds(value.bounds) &&
      value.sequence === 0 &&
      value.epoch === meta.epoch &&
      value.authorGeneration === authorGeneration
    );
  }

  private async updateAfterglow(meta: PodMetaRow): Promise<void> {
    const hasSeat = [...this.uniqueRoles().values()].some(
      (role) => role === "drawer" || role === "paused",
    );
    const previousExpiresAt = meta.expires_at;
    const previousFadeAt = meta.fade_at;
    if (hasSeat) {
      meta.expires_at = null;
      meta.fade_at = null;
    } else if (meta.expires_at === null) {
      meta.expires_at = Date.now() + this.afterglowMilliseconds();
      meta.fade_at = Math.max(
        Date.now(),
        meta.expires_at - Math.min(this.fadeMilliseconds(), this.afterglowMilliseconds()),
      );
    }
    if (meta.expires_at !== previousExpiresAt || meta.fade_at !== previousFadeAt) {
      meta.revision += 1;
      meta.last_activity_at = Date.now();
    }
    this.writeMeta(meta);
    if (meta.expires_at !== previousExpiresAt || meta.fade_at !== previousFadeAt) {
      this.broadcastLifecycle(meta);
    }
    await this.scheduleAlarm();
  }

  private async promote(socket: WebSocket, attachment: PodAttachment, meta: PodMetaRow): Promise<void> {
    const roles = this.uniqueRoles();
    const pending = this.pendingRoles();
    for (const sessionId of roles.keys()) pending.delete(sessionId);
    pending.delete(attachment.sessionId);
    const seats = [...roles.entries()].filter(
      ([sessionId, role]) => sessionId !== attachment.sessionId && (role === "drawer" || role === "paused"),
    ).length + [...pending.values()].filter((role) => role === "drawer").length;
    if (seats >= MAX_DRAWERS) {
      closeWithError(socket, "SEAT_TAKEN", "That drawing seat was taken.");
      return;
    }
    attachment.role = "drawer";
    attachment.pausedUntil = null;
    socket.serializeAttachment(attachment);
    meta.expires_at = null;
    meta.fade_at = null;
    this.broadcastPresence(meta);
    this.broadcastLifecycle(meta);
    await this.notifyLobby(attachment.sessionId, true);
    send(socket, {
      type: "pod:snapshot",
      epoch: meta.epoch,
      revision: meta.revision,
      selfAuthorGeneration: attachment.authorGeneration,
      participants: this.participants(),
      strokes: this.publicStrokes(meta),
      fadeAt: meta.fade_at,
      expiresAt: meta.expires_at,
    });
  }

  private broadcastCursorRemoval(attachment: PodAttachment, except?: WebSocket): void {
    const cursor = attachment.cursor;
    if (!cursor?.visible) return;
    attachment.cursor = { ...cursor, visible: false, seenAt: Date.now() };
    this.broadcast(
      {
        type: "cursor:move",
        authorId: attachment.sessionId,
        authorName: attachment.name,
        anchorSchemaVersion: ANCHOR_SCHEMA_VERSION,
        ...attachment.cursor,
      },
      except,
    );
  }

  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    return this.exclusive(async () => {
      const attachment = podAttachment(socket);
      const meta = this.meta();
      if (!attachment || !meta) return;
      if (
        fatalConfigurationError(socket, attachment.generation, this.env, true) ||
        meta.generation !== attachment.generation
      ) {
        if (meta.generation !== attachment.generation) {
          closeWithError(socket, "GENERATION_CHANGED", "This public drawing generation has ended.", true);
        }
        return;
      }
      if (!this.isCurrentAuthorGeneration(attachment)) {
        closeWithError(socket, "STALE_AUTHOR", "This drawing connection has been replaced.", true);
        return;
      }
      if (!rateAllowed(socket, attachment)) {
        closeWithError(socket, "RATE_LIMITED", "Drawing updates are arriving too quickly.");
        return;
      }
      const message = parseJsonMessage(data);
      if (!message) {
        closeWithError(socket, "INVALID_MESSAGE", "The pod message is invalid.");
        return;
      }
      if (message.type === "ping" && typeof message.nonce === "string") {
        send(socket, { type: "pong", nonce: message.nonce.slice(0, 80) });
        return;
      }
      if (message.type === "seat:promote") {
        await this.promote(socket, attachment, meta);
        return;
      }
      if (message.type === "seat:pause" && attachment.role === "drawer") {
        this.broadcastCursorRemoval(attachment, socket);
        attachment.role = "paused";
        attachment.pausedUntil = Date.now() + this.seatHoldMilliseconds();
        socket.serializeAttachment(attachment);
        this.broadcastPresence(meta);
        await this.notifyLobby(attachment.sessionId, false);
        await this.scheduleAlarm();
        return;
      }
      if (message.type === "seat:release") {
        this.broadcastCursorRemoval(attachment, socket);
        attachment.role = "watcher";
        attachment.pausedUntil = null;
        socket.serializeAttachment(attachment);
        this.broadcastPresence(meta);
        await this.notifyLobby(attachment.sessionId, false);
        await this.updateAfterglow(meta);
        return;
      }
      if (
        message.type === "cursor:move" &&
        attachment.role === "drawer" &&
        validAnchor(message.anchorId, message.anchorSchemaVersion) &&
        isNormalizedCoordinate(message.x) &&
        isNormalizedCoordinate(message.y) &&
        isColor(message.color) &&
        typeof message.visible === "boolean"
      ) {
        const now = Date.now();
        if (message.visible && attachment.cursor && now - attachment.cursor.seenAt < 50) return;
        attachment.cursor = {
          anchorId: message.anchorId,
          x: message.x,
          y: message.y,
          color: message.color,
          visible: message.visible,
          seenAt: now,
        };
        socket.serializeAttachment(attachment);
        this.broadcast(
          {
            type: "cursor:move",
            authorId: attachment.sessionId,
            authorName: attachment.name,
            anchorSchemaVersion: ANCHOR_SCHEMA_VERSION,
            anchorId: message.anchorId,
            x: message.x,
            y: message.y,
            color: message.color,
            visible: message.visible,
            seenAt: now,
          },
          socket,
        );
        return;
      }
      if (message.type === "stroke:start" && attachment.role === "drawer") {
        if (!this.validStrokeStart(message.stroke, meta, attachment.authorGeneration)) {
          closeWithError(socket, "INVALID_MESSAGE", "The public stroke is invalid.");
          return;
        }
        const existing = this.activeStroke(
          attachment.sessionId,
          attachment.authorGeneration,
          message.stroke.id,
        );
        if (existing) return;
        const count = this.ctx.storage.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM strokes WHERE epoch = ?", meta.epoch).one().count;
        const pointCount = message.stroke.points.length / 2;
        if (count >= MAX_STROKES || meta.total_points + pointCount > MAX_TOTAL_POINTS) {
          closeWithError(socket, "POD_FULL", "This public drawing pod is full.");
          return;
        }
        const bounds = boundsForPoints(message.stroke.points);
        this.ctx.storage.sql.exec(
          `INSERT INTO strokes
            (id, author_id, author_name, route, color, width, opacity, created_at,
             anchor_schema_version, anchor_id, bounds_json, sequence, epoch, author_generation, ended)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0)`,
          message.stroke.id,
          attachment.sessionId,
          attachment.name,
          meta.route,
          message.stroke.color,
          DRAWING_STROKE_WIDTH,
          DRAWING_STROKE_OPACITY,
          Date.now(),
          ANCHOR_SCHEMA_VERSION,
          message.stroke.anchorId,
          JSON.stringify(bounds),
          meta.epoch,
          attachment.authorGeneration,
        );
        this.ctx.storage.sql.exec(
          `INSERT INTO stroke_chunks
            (stroke_id, author_id, author_generation, sequence, points_json)
           VALUES (?, ?, ?, 0, ?)`,
          message.stroke.id,
          attachment.sessionId,
          attachment.authorGeneration,
          JSON.stringify(message.stroke.points),
        );
        meta.total_points += pointCount;
        meta.revision += 1;
        meta.last_activity_at = Date.now();
        meta.expires_at = null;
        this.writeMeta(meta);
        const stroke: PublicStroke = {
          ...message.stroke,
          authorId: attachment.sessionId,
          authorName: attachment.name,
          authorGeneration: attachment.authorGeneration,
          createdAt: Date.now(),
          bounds,
        };
        this.broadcast({ type: "stroke:start", stroke, revision: meta.revision }, socket);
        return;
      }
      if (message.type === "stroke:append" && attachment.role === "drawer") {
        if (
          typeof message.strokeId !== "string" ||
          !STROKE_ID_PATTERN.test(message.strokeId) ||
          !validAnchor(message.anchorId, message.anchorSchemaVersion) ||
          !Number.isInteger(message.sequence) ||
          !isNormalizedPoints(message.points) ||
          !isBounds(message.bounds) ||
          message.epoch !== meta.epoch ||
          message.authorGeneration !== attachment.authorGeneration
        ) {
          closeWithError(socket, "INVALID_MESSAGE", "The stroke append is invalid.");
          return;
        }
        const sequence = message.sequence as number;
        const stroke = this.activeStroke(
          attachment.sessionId,
          attachment.authorGeneration,
          message.strokeId,
        );
        if (!stroke || stroke.ended || stroke.anchor_id !== message.anchorId) {
          closeWithError(socket, "STROKE_NOT_FOUND", "That public stroke is not active.");
          return;
        }
        if (sequence <= stroke.sequence) return;
        if (sequence !== stroke.sequence + 1) {
          closeWithError(socket, "SEQUENCE_GAP", "The stroke append is out of order.");
          return;
        }
        const existingPoints = this.ctx.storage.sql.exec<{ count: number }>(
          `SELECT COALESCE(SUM(json_array_length(points_json) / 2), 0) AS count
           FROM stroke_chunks WHERE stroke_id = ? AND author_id = ? AND author_generation = ?`,
          stroke.id,
          stroke.author_id,
          stroke.author_generation,
        ).one().count;
        const addedPoints = message.points.length / 2;
        if (
          existingPoints + addedPoints > MAX_POINTS_PER_STROKE ||
          meta.total_points + addedPoints > MAX_TOTAL_POINTS
        ) {
          closeWithError(socket, "POD_FULL", "This public drawing pod is full.");
          return;
        }
        const nextBounds = mergeBounds(JSON.parse(stroke.bounds_json) as NormalizedBounds, boundsForPoints(message.points));
        this.ctx.storage.sql.exec(
          `INSERT INTO stroke_chunks
            (stroke_id, author_id, author_generation, sequence, points_json)
           VALUES (?, ?, ?, ?, ?)`,
          stroke.id,
          stroke.author_id,
          stroke.author_generation,
          sequence,
          JSON.stringify(message.points),
        );
        this.ctx.storage.sql.exec(
          `UPDATE strokes SET sequence = ?, bounds_json = ?
           WHERE id = ? AND author_id = ? AND author_generation = ?`,
          sequence,
          JSON.stringify(nextBounds),
          stroke.id,
          stroke.author_id,
          stroke.author_generation,
        );
        meta.total_points += addedPoints;
        meta.revision += 1;
        meta.last_activity_at = Date.now();
        this.writeMeta(meta);
        this.broadcast(
          {
            type: "stroke:append",
            authorId: attachment.sessionId,
            authorGeneration: attachment.authorGeneration,
            strokeId: stroke.id,
            sequence,
            points: message.points,
            bounds: nextBounds,
            epoch: meta.epoch,
            revision: meta.revision,
          },
          socket,
        );
        return;
      }
      if (message.type === "stroke:end" && attachment.role === "drawer") {
        if (
          typeof message.strokeId !== "string" ||
          !Number.isInteger(message.sequence) ||
          message.epoch !== meta.epoch ||
          message.authorGeneration !== attachment.authorGeneration
        ) {
          closeWithError(socket, "INVALID_MESSAGE", "The stroke end is invalid.");
          return;
        }
        const sequence = message.sequence as number;
        const stroke = this.activeStroke(
          attachment.sessionId,
          attachment.authorGeneration,
          message.strokeId,
        );
        if (!stroke) return;
        if (stroke.ended && sequence <= stroke.sequence) return;
        if (sequence !== stroke.sequence + 1) {
          closeWithError(socket, "SEQUENCE_GAP", "The stroke end is out of order.");
          return;
        }
        this.ctx.storage.sql.exec(
          `UPDATE strokes SET ended = 1, sequence = ?
           WHERE id = ? AND author_id = ? AND author_generation = ?`,
          sequence,
          stroke.id,
          stroke.author_id,
          stroke.author_generation,
        );
        meta.revision += 1;
        meta.last_activity_at = Date.now();
        this.writeMeta(meta);
        this.broadcast(
          {
            type: "stroke:end",
            authorId: attachment.sessionId,
            authorGeneration: attachment.authorGeneration,
            strokeId: stroke.id,
            sequence,
            epoch: meta.epoch,
            revision: meta.revision,
          },
          socket,
        );
        return;
      }
      if (message.type === "clear:mine") {
        this.broadcastCursorRemoval(attachment, socket);
        const owned = this.ctx.storage.sql
          .exec<{ id: string; point_count: number }>(
            `SELECT s.id,
              COALESCE((SELECT SUM(json_array_length(c.points_json) / 2)
                        FROM stroke_chunks c
                        WHERE c.stroke_id = s.id AND c.author_id = s.author_id
                          AND c.author_generation = s.author_generation), 0) AS point_count
             FROM strokes s WHERE s.author_id = ? AND s.epoch = ?`,
            attachment.sessionId,
            meta.epoch,
          )
          .toArray();
        this.ctx.storage.sql.exec(
          `DELETE FROM stroke_chunks WHERE author_id = ? AND EXISTS (
            SELECT 1 FROM strokes s WHERE s.id = stroke_chunks.stroke_id
              AND s.author_id = stroke_chunks.author_id
              AND s.author_generation = stroke_chunks.author_generation
              AND s.author_id = ? AND s.epoch = ?
          )`,
          attachment.sessionId,
          attachment.sessionId,
          meta.epoch,
        );
        this.ctx.storage.sql.exec(
          "DELETE FROM strokes WHERE author_id = ? AND epoch = ?",
          attachment.sessionId,
          meta.epoch,
        );
        attachment.authorGeneration += 1;
        attachment.cursor = null;
        socket.serializeAttachment(attachment);
        this.ctx.storage.sql.exec(
          "UPDATE author_generations SET generation = ? WHERE author_id = ?",
          attachment.authorGeneration,
          attachment.sessionId,
        );
        meta.total_points = Math.max(
          0,
          meta.total_points - owned.reduce((sum, row) => sum + row.point_count, 0),
        );
        meta.revision += 1;
        meta.last_activity_at = Date.now();
        this.writeMeta(meta);
        this.broadcast({
          type: "strokes:cleared",
          scope: "mine",
          authorId: attachment.sessionId,
          authorGeneration: attachment.authorGeneration,
          epoch: meta.epoch,
          revision: meta.revision,
        });
        aggregateLog("public_marks_cleared", { remainingPoints: meta.total_points });
        return;
      }
      closeWithError(socket, "INVALID_MESSAGE", "The pod message is invalid.");
    }).catch(() => {
      closeWithError(socket, "SERVER_ERROR", "The public drawing pod could not process that update.");
    });
  }

  private connectionEnded(socket: WebSocket): Promise<void> {
    return this.exclusive(async () => {
      const attachment = podAttachment(socket);
      const meta = this.meta();
      if (!attachment || !meta) return;
      this.broadcastCursorRemoval(attachment, socket);
      await this.notifyLobby(attachment.sessionId, false, false);
      this.broadcastPresence(meta);
      await this.updateAfterglow(meta);
    });
  }

  webSocketClose(socket: WebSocket): Promise<void> {
    return this.connectionEnded(socket);
  }

  webSocketError(socket: WebSocket): Promise<void> {
    return this.connectionEnded(socket);
  }

  private async scheduleAlarm(): Promise<void> {
    const now = Date.now();
    const grant = this.ctx.storage.sql
      .exec<{ at: number | null }>("SELECT MIN(expires_at) AS at FROM grants WHERE used = 0 AND expires_at > ?", now)
      .one().at;
    const paused = this.sockets()
      .map(({ attachment }) => attachment.pausedUntil)
      .filter((value): value is number => value !== null && value > now)
      .sort((a, b) => a - b)[0] ?? null;
    const expiresAt = this.meta()?.expires_at ?? null;
    const candidates = [grant, paused, expiresAt].filter(
      (value): value is number => value !== null && value > now,
    );
    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.min(...candidates));
    }
  }

  alarm(): Promise<void> {
    return this.exclusive(async () => {
      const now = Date.now();
      this.ctx.storage.sql.exec("DELETE FROM grants WHERE used = 0 AND expires_at <= ?", now);
      const demoted = new Set<string>();
      for (const { socket, attachment } of this.sockets()) {
        if (
          attachment.role === "paused" &&
          attachment.pausedUntil !== null &&
          attachment.pausedUntil <= now
        ) {
          attachment.role = "watcher";
          attachment.pausedUntil = null;
          socket.serializeAttachment(attachment);
          demoted.add(attachment.sessionId);
        }
      }
      for (const sessionId of demoted) await this.notifyLobby(sessionId, false);

      const meta = this.meta();
      if (!meta) return;
      const mode = publicDrawingMode(this.env);
      const generation = publicDrawingGeneration(this.env);
      if (mode !== "live" || generation !== meta.generation) {
        for (const { socket } of this.sockets()) {
          closeWithError(
            socket,
            mode === "off" ? "PUBLIC_DISABLED" : mode === "presence" ? "LIVE_DISABLED" : "GENERATION_CHANGED",
            mode === "live" ? "This public drawing generation has ended." : "Live drawing is unavailable.",
            true,
          );
        }
      }
      if (demoted.size > 0) this.broadcastPresence(meta);
      await this.updateAfterglow(meta);
      if (meta.expires_at !== null && meta.expires_at <= now) {
        this.ctx.storage.sql.exec("DELETE FROM stroke_chunks");
        this.ctx.storage.sql.exec("DELETE FROM strokes");
        const connectedAuthors = new Set(
          this.sockets().map(({ attachment }) => attachment.sessionId),
        );
        for (const { author_id: authorId } of this.ctx.storage.sql
          .exec<{ author_id: string }>("SELECT author_id FROM author_generations")
          .toArray()) {
          if (!connectedAuthors.has(authorId)) {
            this.ctx.storage.sql.exec(
              "DELETE FROM author_generations WHERE author_id = ?",
              authorId,
            );
          }
        }
        meta.epoch += 1;
        meta.revision += 1;
        meta.total_points = 0;
        meta.expires_at = null;
        meta.fade_at = null;
        meta.last_activity_at = now;
        this.writeMeta(meta);
        this.broadcast({ type: "pod:expired", epoch: meta.epoch, revision: meta.revision });
        this.broadcastLifecycle(meta);
        aggregateLog("public_pod_expired", { epoch: meta.epoch });
      }
      await this.scheduleAlarm();
    });
  }
}
