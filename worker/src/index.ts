import { DurableObject } from "cloudflare:workers";

import {
  DRAWING_REALTIME_PATH_PREFIX,
  DRAWING_REALTIME_PROTOCOL_VERSION,
  DRAWING_REALTIME_SUBPROTOCOL,
  DRAWING_ROOM_MAX_PARTICIPANTS,
  DRAWING_ROOM_MAX_POINTS_PER_MESSAGE,
  DRAWING_ROOM_MAX_POINTS_PER_STROKE,
  DRAWING_ROOM_MAX_SOCKETS,
  DRAWING_ROOM_MAX_STROKES,
  type DrawingBounds,
  type DrawingClientMessage,
  type DrawingParticipant,
  type DrawingRoomErrorCode,
  type DrawingServerMessage,
  type DrawingSharedStroke,
  drawingParticipantTokenFromWebSocketProtocols,
  hasDrawingRealtimeSubprotocol,
  isDrawingParticipantId,
  isDrawingParticipantName,
  isDrawingParticipantToken,
  isDrawingRoomId,
  normalizeDrawingParticipantName,
  normalizeDrawingRoute,
  parseDrawingClientMessageJson,
} from "../../app/lib/drawingRealtimeProtocol";

const META_KEY = "room:meta";
const STROKE_PREFIX = "stroke:";
const IDENTITY_PREFIX = "identity:";
const DEFAULT_ROOM_TTL_SECONDS = 30 * 60;
const MAX_ROOM_TOTAL_POINTS = 200_000;
const RATE_WINDOW_MS = 1_000;
const MAX_MESSAGES_PER_RATE_WINDOW = 120;
const MAX_CONNECTIONS_PER_PARTICIPANT = 2;
const MAX_REGISTERED_IDENTITIES = 32;
const MAX_STORAGE_DELETE_BATCH = 128;

interface Env {
  DRAWING_ROOMS: DurableObjectNamespace<DrawingRoom>;
  ALLOWED_ORIGINS?: string;
  ROOM_TTL_SECONDS?: string;
}

interface RoomMeta {
  version: 1;
  hostId: string;
  revision: number;
  strokeCount: number;
  totalPoints: number;
  lastActivityAt: number;
  emptySince: number | null;
}

interface SocketAttachment {
  version: 1;
  participantId: string;
  name: string;
  joinedAt: number;
  route: string;
  rateWindowStartedAt: number;
  rateMessageCount: number;
  rejected?: true;
}

interface StoredDrawingStroke extends DrawingSharedStroke {
  ended?: boolean;
}

function jsonResponse(
  body: unknown,
  init: ResponseInit = {},
  extraHeaders?: HeadersInit,
): Response {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  if (extraHeaders) {
    new Headers(extraHeaders).forEach((value, key) => headers.set(key, value));
  }
  return new Response(JSON.stringify(body), { ...init, headers });
}

function allowedOrigins(env: Env): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("origin");
  return origin && allowedOrigins(env).has(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-methods": "GET,OPTIONS",
        "access-control-allow-headers": "content-type",
        vary: "Origin",
      }
    : {};
}

function isAllowedOrigin(request: Request, env: Env): boolean {
  const origin = request.headers.get("origin");
  // This enforces the browser-facing cross-origin policy. Origin is not an
  // authentication mechanism; non-browser clients can supply it themselves.
  return origin !== null && allowedOrigins(env).has(origin);
}

function roomIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(DRAWING_REALTIME_PATH_PREFIX)) return null;
  const tail = pathname.slice(DRAWING_REALTIME_PATH_PREFIX.length);
  if (tail.includes("/")) return null;
  return isDrawingRoomId(tail) ? tail : null;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse(
        { ok: true, service: "mistakes-party-drawing-realtime" },
        {},
        corsHeaders(request, env),
      );
    }

    if (request.method === "OPTIONS") {
      if (!isAllowedOrigin(request, env)) {
        return jsonResponse(
          { code: "FORBIDDEN_ORIGIN", message: "Origin is not allowed." },
          { status: 403 },
        );
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(request, env),
      });
    }

    const roomId = roomIdFromPath(url.pathname);
    if (request.method !== "GET" || roomId === null) {
      return jsonResponse(
        { code: "NOT_FOUND", message: "Drawing room not found." },
        { status: 404 },
        corsHeaders(request, env),
      );
    }

    if (!isAllowedOrigin(request, env)) {
      return jsonResponse(
        { code: "FORBIDDEN_ORIGIN", message: "Origin is not allowed." },
        { status: 403 },
      );
    }

    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return jsonResponse(
        { code: "UPGRADE_REQUIRED", message: "A WebSocket upgrade is required." },
        { status: 426, headers: { upgrade: "websocket" } },
        corsHeaders(request, env),
      );
    }

    if (
      !hasDrawingRealtimeSubprotocol(
        request.headers.get("sec-websocket-protocol"),
      )
    ) {
      return jsonResponse(
        {
          code: "BAD_REQUEST",
          message: "The drawing WebSocket protocol is required.",
        },
        { status: 400 },
        corsHeaders(request, env),
      );
    }

    const participantId = url.searchParams.get("participantId");
    if (!isDrawingParticipantId(participantId)) {
      return jsonResponse(
        { code: "BAD_REQUEST", message: "A valid participantId is required." },
        { status: 400 },
        corsHeaders(request, env),
      );
    }

    const roomObjectId = env.DRAWING_ROOMS.idFromName(roomId);
    return env.DRAWING_ROOMS.get(roomObjectId).fetch(request);
  },
} satisfies ExportedHandler<Env>;

function parseAttachment(socket: WebSocket): SocketAttachment | null {
  try {
    const value = socket.deserializeAttachment() as Partial<SocketAttachment> | null;
    return value?.version === 1 &&
      typeof value.participantId === "string" &&
      isDrawingParticipantName(value.name) &&
      typeof value.joinedAt === "number" &&
      typeof value.route === "string"
      ? (value as SocketAttachment)
      : null;
  } catch {
    return null;
  }
}

function activeSockets(ctx: DurableObjectState): WebSocket[] {
  return ctx.getWebSockets().filter((socket) => socket.readyState === 1);
}

function socketParticipants(ctx: DurableObjectState): DrawingParticipant[] {
  const byId = new Map<string, DrawingParticipant>();

  for (const socket of activeSockets(ctx)) {
    const attachment = parseAttachment(socket);
    if (!attachment || attachment.rejected) continue;
    const existing = byId.get(attachment.participantId);
    if (existing) {
      existing.connections += 1;
      if (attachment.joinedAt < existing.joinedAt) {
        existing.joinedAt = attachment.joinedAt;
        existing.name = attachment.name;
        existing.route = attachment.route;
      }
    } else {
      byId.set(attachment.participantId, {
        id: attachment.participantId,
        name: attachment.name,
        joinedAt: attachment.joinedAt,
        connections: 1,
        route: attachment.route,
      });
    }
  }

  return [...byId.values()].sort(
    (left, right) =>
      left.joinedAt - right.joinedAt || left.id.localeCompare(right.id),
  );
}

function strokeStoragePrefix(route: string): string {
  return `${STROKE_PREFIX}${encodeURIComponent(route)}:`;
}

function strokeStorageKey(
  route: string,
  authorId: string,
  strokeId: string,
): string {
  return `${strokeStoragePrefix(route)}${authorId}:${strokeId}`;
}

function mergedBounds(
  previous: DrawingBounds,
  points: readonly number[],
): DrawingBounds {
  const next = { ...previous };
  for (let index = 0; index < points.length; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    next.minX = Math.min(next.minX, x);
    next.minY = Math.min(next.minY, y);
    next.maxX = Math.max(next.maxX, x);
    next.maxY = Math.max(next.maxY, y);
  }
  return next;
}

export class DrawingRoom extends DurableObject<Env> {
  private operationQueue: Promise<unknown> = Promise.resolve();

  private exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.catch(() => undefined);
    return result;
  }

  private roomId(request: Request): string {
    return roomIdFromPath(new URL(request.url).pathname) ?? "unknown-room";
  }

  private ttlMilliseconds(): number {
    const configured = Number.parseInt(this.env.ROOM_TTL_SECONDS ?? "", 10);
    const seconds = Number.isFinite(configured)
      ? Math.max(60, Math.min(configured, 24 * 60 * 60))
      : DEFAULT_ROOM_TTL_SECONDS;
    return seconds * 1_000;
  }

  private async meta(fallbackHostId: string): Promise<RoomMeta> {
    const stored = await this.ctx.storage.get<RoomMeta>(META_KEY);
    return stored?.version === 1
      ? stored
      : {
          version: 1,
          hostId: fallbackHostId,
          revision: 0,
          strokeCount: 0,
          totalPoints: 0,
          lastActivityAt: Date.now(),
          emptySince: null,
        };
  }

  private send(socket: WebSocket, message: DrawingServerMessage): void {
    try {
      socket.send(JSON.stringify(message));
    } catch {
      // A peer may disconnect between getWebSockets() and send().
    }
  }

  private error(
    socket: WebSocket,
    code: DrawingRoomErrorCode,
    message: string,
    fatal = false,
  ): void {
    this.send(socket, { type: "error", code, message, fatal: fatal || undefined });
    if (fatal) {
      try {
        socket.close(1008, code);
      } catch {
        // The peer may already have closed.
      }
    }
  }

  private broadcast(
    message: DrawingServerMessage,
    options: { route?: string; except?: WebSocket } = {},
  ): void {
    for (const socket of activeSockets(this.ctx)) {
      if (socket === options.except) continue;
      const attachment = parseAttachment(socket);
      if (!attachment || attachment.rejected) continue;
      if (options.route && attachment.route !== options.route) continue;
      this.send(socket, message);
    }
  }

  private async routeStrokes(route: string): Promise<DrawingSharedStroke[]> {
    const records = await this.ctx.storage.list<StoredDrawingStroke>({
      prefix: strokeStoragePrefix(route),
    });
    return [...records.values()]
      .map((stroke) => ({
        version: stroke.version,
        id: stroke.id,
        route: stroke.route,
        color: stroke.color,
        width: stroke.width,
        opacity: stroke.opacity,
        createdAt: stroke.createdAt,
        points: stroke.points,
        bounds: stroke.bounds,
        authorId: stroke.authorId,
        authorName: stroke.authorName,
      }))
      .sort(
        (left, right) =>
          left.createdAt - right.createdAt || left.id.localeCompare(right.id),
      );
  }

  private async deleteKeysAndWriteMeta(
    keys: readonly string[],
    meta: RoomMeta,
  ): Promise<void> {
    await this.ctx.storage.transaction(async (transaction) => {
      for (let index = 0; index < keys.length; index += MAX_STORAGE_DELETE_BATCH) {
        await transaction.delete(
          keys.slice(index, index + MAX_STORAGE_DELETE_BATCH),
        );
      }
      await transaction.put(META_KEY, meta);
    });
  }

  private async broadcastPresence(meta: RoomMeta): Promise<void> {
    const participants = socketParticipants(this.ctx);
    if (!participants.some((participant) => participant.id === meta.hostId)) {
      meta.hostId = participants[0]?.id ?? meta.hostId;
    }
    meta.revision += 1;
    meta.lastActivityAt = Date.now();
    await this.ctx.storage.put(META_KEY, meta);
    this.broadcast({
      type: "presence",
      hostId: meta.hostId,
      participants,
      revision: meta.revision,
    });
  }

  async fetch(request: Request): Promise<Response> {
    return this.exclusive(async () => {
      const url = new URL(request.url);
      const participantId = url.searchParams.get("participantId");
      if (!isDrawingParticipantId(participantId)) {
        return jsonResponse(
          { code: "BAD_REQUEST", message: "A valid participantId is required." },
          { status: 400 },
        );
      }

      const name = normalizeDrawingParticipantName(url.searchParams.get("name"));
      const participantToken = drawingParticipantTokenFromWebSocketProtocols(
        request.headers.get("sec-websocket-protocol"),
      );
      const route = normalizeDrawingRoute(url.searchParams.get("route") ?? "/");
      const participantsBeforeJoin = socketParticipants(this.ctx);
      const socketsBeforeJoin = activeSockets(this.ctx).filter(
        (socket) => !parseAttachment(socket)?.rejected,
      );
      const returningParticipant = participantsBeforeJoin.some(
        (participant) => participant.id === participantId,
      );
      const participantConnections =
        participantsBeforeJoin.find(
          (participant) => participant.id === participantId,
        )?.connections ?? 0;

      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      const now = Date.now();
      const storedToken = isDrawingParticipantToken(participantToken)
        ? await this.ctx.storage.get<string>(`${IDENTITY_PREFIX}${participantId}`)
        : undefined;
      const registeredIdentities =
        storedToken === undefined && isDrawingParticipantToken(participantToken)
          ? await this.ctx.storage.list<string>({
              prefix: IDENTITY_PREFIX,
              limit: MAX_REGISTERED_IDENTITIES,
            })
          : null;
      const identityRejected =
        !isDrawingParticipantToken(participantToken) ||
        (storedToken !== undefined && storedToken !== participantToken);
      const rejection = (() => {
        if (identityRejected) {
          return {
            code: "BAD_REQUEST" as const,
            message: "The participant identity is invalid.",
          };
        }
        if (
          registeredIdentities !== null &&
          registeredIdentities.size >= MAX_REGISTERED_IDENTITIES
        ) {
          return {
            code: "ROOM_LIMIT_REACHED" as const,
            message: "This party has reached its guest history limit.",
          };
        }
        if (participantConnections >= MAX_CONNECTIONS_PER_PARTICIPANT) {
          return {
            code: "TOO_MANY_CONNECTIONS" as const,
            message: "This participant already has two open connections.",
          };
        }
        if (socketsBeforeJoin.length >= DRAWING_ROOM_MAX_SOCKETS) {
          return {
            code: "TOO_MANY_CONNECTIONS" as const,
            message: "This party has too many open connections.",
          };
        }
        if (
          !returningParticipant &&
          participantsBeforeJoin.length >= DRAWING_ROOM_MAX_PARTICIPANTS
        ) {
          return {
            code: "ROOM_FULL" as const,
            message: "This party already has four people.",
          };
        }
        return null;
      })();

      const attachment: SocketAttachment = {
        version: 1,
        participantId,
        name,
        joinedAt: now,
        route,
        rateWindowStartedAt: now,
        rateMessageCount: 0,
        rejected: rejection ? true : undefined,
      };
      server.serializeAttachment(attachment);
      this.ctx.acceptWebSocket(server, [`participant:${participantId}`]);

      if (rejection) {
        this.error(server, rejection.code, rejection.message, true);
        return new Response(null, {
          status: 101,
          webSocket: client,
          headers: {
            "sec-websocket-protocol": DRAWING_REALTIME_SUBPROTOCOL,
          },
        });
      }

      if (storedToken === undefined) {
        await this.ctx.storage.put(
          `${IDENTITY_PREFIX}${participantId}`,
          participantToken,
        );
      }

      const meta = await this.meta(participantId);
      meta.emptySince = null;
      const participantsAfterJoin = socketParticipants(this.ctx);
      if (
        !participantsAfterJoin.some(
          (participant) => participant.id === meta.hostId,
        )
      ) {
        meta.hostId = participantsAfterJoin[0]?.id ?? participantId;
      }
      meta.revision += 1;
      meta.lastActivityAt = now;
      await Promise.all([
        this.ctx.storage.put(META_KEY, meta),
        this.ctx.storage.deleteAlarm(),
      ]);

      const strokes = await this.routeStrokes(route);
      const participants = participantsAfterJoin;
      this.send(server, {
        type: "welcome",
        protocolVersion: DRAWING_REALTIME_PROTOCOL_VERSION,
        roomId: this.roomId(request),
        selfId: participantId,
        hostId: meta.hostId,
        participants,
        route,
        strokes,
        revision: meta.revision,
      });
      this.broadcast(
        {
          type: "presence",
          hostId: meta.hostId,
          participants,
          revision: meta.revision,
        },
        { except: server },
      );

      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: {
          "sec-websocket-protocol": DRAWING_REALTIME_SUBPROTOCOL,
        },
      });
    });
  }

  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): Promise<void> {
    return this.exclusive(async () => {
      const attachment = parseAttachment(socket);
      if (!attachment || attachment.rejected) return;
      if (typeof data !== "string") {
        this.error(socket, "INVALID_MESSAGE", "Only JSON text messages are accepted.");
        return;
      }

      const now = Date.now();
      if (now - attachment.rateWindowStartedAt >= RATE_WINDOW_MS) {
        attachment.rateWindowStartedAt = now;
        attachment.rateMessageCount = 0;
      }
      attachment.rateMessageCount += 1;
      socket.serializeAttachment(attachment);
      if (attachment.rateMessageCount > MAX_MESSAGES_PER_RATE_WINDOW) {
        this.error(socket, "RATE_LIMITED", "Drawing updates are arriving too quickly.");
        return;
      }

      const message = parseDrawingClientMessageJson(data);
      if (!message) {
        this.error(socket, "INVALID_MESSAGE", "The drawing message is invalid.");
        return;
      }

      await this.handleMessage(socket, attachment, message);
    }).catch(() => {
      this.error(socket, "SERVER_ERROR", "The drawing room could not process that update.");
    });
  }

  private routeMatches(
    socket: WebSocket,
    attachment: SocketAttachment,
    route: string,
  ): boolean {
    if (attachment.route === route) return true;
    this.error(socket, "INVALID_MESSAGE", "The update does not match the active route.");
    return false;
  }

  private async handleMessage(
    socket: WebSocket,
    attachment: SocketAttachment,
    message: DrawingClientMessage,
  ): Promise<void> {
    if (message.type === "ping") {
      this.send(socket, { type: "pong", nonce: message.nonce });
      return;
    }

    if (message.type === "cursor:move") {
      if (!this.routeMatches(socket, attachment, message.route)) return;
      this.broadcast(
        {
          type: "cursor:move",
          route: message.route,
          authorId: attachment.participantId,
          authorName: attachment.name,
          x: message.x,
          y: message.y,
          color: message.color,
          visible: message.visible,
        },
        { route: message.route, except: socket },
      );
      return;
    }

    const meta = await this.meta(attachment.participantId);

    if (message.type === "route:set") {
      attachment.route = message.route;
      socket.serializeAttachment(attachment);
      meta.revision += 1;
      meta.lastActivityAt = Date.now();
      await this.ctx.storage.put(META_KEY, meta);
      this.send(socket, {
        type: "route:snapshot",
        route: message.route,
        strokes: await this.routeStrokes(message.route),
        revision: meta.revision,
      });
      await this.broadcastPresence(meta);
      return;
    }

    if (message.type === "stroke:start") {
      if (!this.routeMatches(socket, attachment, message.stroke.route)) return;
      if (message.stroke.points.length > DRAWING_ROOM_MAX_POINTS_PER_MESSAGE * 2) {
        this.error(socket, "INVALID_MESSAGE", "The first stroke batch is too large.");
        return;
      }

      const stroke: DrawingSharedStroke = {
        ...message.stroke,
        createdAt: Date.now(),
        points: [...message.stroke.points],
        bounds: { ...message.stroke.bounds },
        authorId: attachment.participantId,
        authorName: attachment.name,
      };
      const key = strokeStorageKey(
        stroke.route,
        attachment.participantId,
        stroke.id,
      );
      const existing = await this.ctx.storage.get<StoredDrawingStroke>(key);
      if (existing) {
        const isExactRetry =
          existing.authorId === stroke.authorId &&
          existing.route === stroke.route &&
          existing.color === stroke.color &&
          existing.width === stroke.width &&
          existing.opacity === stroke.opacity &&
          existing.points.length === stroke.points.length &&
          existing.points.every((point, index) => point === stroke.points[index]);
        if (!isExactRetry) {
          this.error(socket, "INVALID_MESSAGE", "That stroke ID is already in use.");
        }
        return;
      }
      if (
        meta.strokeCount >= DRAWING_ROOM_MAX_STROKES ||
        meta.totalPoints + message.stroke.points.length / 2 > MAX_ROOM_TOTAL_POINTS
      ) {
        this.error(socket, "ROOM_LIMIT_REACHED", "This party drawing is full.");
        return;
      }
      meta.strokeCount += 1;
      meta.totalPoints += stroke.points.length / 2;
      meta.revision += 1;
      meta.lastActivityAt = Date.now();
      await this.ctx.storage.put({
        [key]: { ...stroke, ended: false } satisfies StoredDrawingStroke,
        [META_KEY]: meta,
      });
      this.broadcast(
        { type: "stroke:start", stroke, revision: meta.revision },
        { route: stroke.route, except: socket },
      );
      return;
    }

    if (message.type === "stroke:append") {
      if (!this.routeMatches(socket, attachment, message.route)) return;
      const key = strokeStorageKey(
        message.route,
        attachment.participantId,
        message.strokeId,
      );
      const stroke = await this.ctx.storage.get<StoredDrawingStroke>(key);
      if (!stroke) {
        this.error(socket, "STROKE_NOT_FOUND", "That stroke is not active in this room.");
        return;
      }
      // Records written before ended-state tracking are already persisted
      // snapshots, so treat a missing flag as completed rather than mutable.
      if (stroke.ended !== false) {
        this.error(socket, "INVALID_MESSAGE", "A completed stroke cannot be changed.");
        return;
      }
      const newPointCount = message.points.length / 2;
      if (
        stroke.points.length / 2 + newPointCount >
          DRAWING_ROOM_MAX_POINTS_PER_STROKE ||
        meta.totalPoints + newPointCount > MAX_ROOM_TOTAL_POINTS
      ) {
        this.error(socket, "ROOM_LIMIT_REACHED", "This party drawing is full.");
        return;
      }
      stroke.points.push(...message.points);
      stroke.bounds = mergedBounds(stroke.bounds, message.points);
      meta.totalPoints += newPointCount;
      meta.revision += 1;
      meta.lastActivityAt = Date.now();
      await this.ctx.storage.put({ [key]: stroke, [META_KEY]: meta });
      this.broadcast(
        {
          type: "stroke:append",
          route: message.route,
          strokeId: message.strokeId,
          authorId: attachment.participantId,
          points: message.points,
          bounds: stroke.bounds,
          revision: meta.revision,
        },
        { route: message.route, except: socket },
      );
      return;
    }

    if (message.type === "stroke:end") {
      if (!this.routeMatches(socket, attachment, message.route)) return;
      const key = strokeStorageKey(
        message.route,
        attachment.participantId,
        message.strokeId,
      );
      const stroke = await this.ctx.storage.get<StoredDrawingStroke>(key);
      if (!stroke) {
        this.error(socket, "STROKE_NOT_FOUND", "That stroke is not active in this room.");
        return;
      }
      if (stroke.ended !== false) return;
      stroke.ended = true;
      meta.revision += 1;
      meta.lastActivityAt = Date.now();
      await this.ctx.storage.put({ [key]: stroke, [META_KEY]: meta });
      this.broadcast(
        {
          type: "stroke:end",
          route: message.route,
          strokeId: message.strokeId,
          authorId: attachment.participantId,
          revision: meta.revision,
        },
        { route: message.route, except: socket },
      );
      return;
    }

    if (message.type === "clear:mine") {
      if (!this.routeMatches(socket, attachment, message.route)) return;
      const strokes = await this.ctx.storage.list<StoredDrawingStroke>({
        prefix: strokeStoragePrefix(message.route),
      });
      const owned = [...strokes.entries()].filter(
        ([, stroke]) => stroke.authorId === attachment.participantId,
      );
      if (owned.length > 0) {
        meta.strokeCount = Math.max(0, meta.strokeCount - owned.length);
        meta.totalPoints = Math.max(
          0,
          meta.totalPoints -
            owned.reduce((sum, [, stroke]) => sum + stroke.points.length / 2, 0),
        );
      }
      meta.revision += 1;
      meta.lastActivityAt = Date.now();
      await this.deleteKeysAndWriteMeta(
        owned.map(([key]) => key),
        meta,
      );
      this.broadcast(
        {
          type: "strokes:cleared",
          scope: "mine",
          route: message.route,
          authorId: attachment.participantId,
          revision: meta.revision,
        },
        { route: message.route },
      );
      return;
    }

    if (message.type === "room:reset") {
      if (meta.hostId !== attachment.participantId) {
        this.error(socket, "NOT_HOST", "Only the party host can reset the room.");
        return;
      }
      const strokes = await this.ctx.storage.list({ prefix: STROKE_PREFIX });
      meta.strokeCount = 0;
      meta.totalPoints = 0;
      meta.revision += 1;
      meta.lastActivityAt = Date.now();
      await this.deleteKeysAndWriteMeta([...strokes.keys()], meta);
      this.broadcast({
        type: "room:reset",
        authorId: attachment.participantId,
        revision: meta.revision,
      });
    }
  }

  webSocketClose(socket: WebSocket): Promise<void> {
    return this.connectionEnded(socket);
  }

  webSocketError(socket: WebSocket): Promise<void> {
    return this.connectionEnded(socket);
  }

  private connectionEnded(socket: WebSocket): Promise<void> {
    return this.exclusive(async () => {
      const attachment = parseAttachment(socket);
      if (!attachment || attachment.rejected) return;
      const meta = await this.meta(attachment.participantId);
      const participants = socketParticipants(this.ctx);
      if (participants.length === 0) {
        meta.emptySince = Date.now();
        meta.lastActivityAt = meta.emptySince;
        await Promise.all([
          this.ctx.storage.put(META_KEY, meta),
          this.ctx.storage.setAlarm(meta.emptySince + this.ttlMilliseconds()),
        ]);
        return;
      }
      await this.broadcastPresence(meta);
    });
  }

  alarm(): Promise<void> {
    return this.exclusive(async () => {
      if (socketParticipants(this.ctx).length > 0) return;
      const meta = await this.ctx.storage.get<RoomMeta>(META_KEY);
      if (!meta?.emptySince) return;
      const expiresAt = meta.emptySince + this.ttlMilliseconds();
      if (Date.now() < expiresAt) {
        await this.ctx.storage.setAlarm(expiresAt);
        return;
      }
      await this.ctx.storage.deleteAll();
    });
  }
}
