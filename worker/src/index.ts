import { DurableObject } from "cloudflare:workers";

import {
  PARTY_PROTOCOL_VERSION,
  PARTY_REALTIME_PATH,
  PARTY_REALTIME_SUBPROTOCOL,
  isPartyRoute,
  isPartySessionId,
  parsePartyClientMessageJson,
  type PartyServerMessage,
} from "../../app/lib/partyProtocol";

const MAX_ROUTE_SOCKETS = 256;
const MAX_SOCKETS_PER_SESSION = 2;
const MESSAGE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 20;
const INVALID_WINDOW_MS = 10_000;
const MAX_INVALID_MESSAGES_PER_WINDOW = 3;
const SIGNAL_WINDOW_MS = 60_000;
const MAX_SIGNALS_PER_WINDOW = 12;
const MIN_SIGNAL_INTERVAL_MS = 1_000;
const ROUTE_SIGNAL_BURST = 12;
const ROUTE_SIGNAL_REFILL_PER_SECOND = 8;
const PARTY_PING_FRAME = JSON.stringify({ type: "ping" });
const PARTY_PONG_FRAME = JSON.stringify({ type: "pong" });
const GENERATION_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

type PartyMode = "off" | "live";

type PartyEnv = GeneratedPartyEnv;

interface PartySocketAttachment {
  version: 1;
  sessionId: string;
  route: string;
  generation: string;
  joinedAt: number;
  messageWindowStartedAt: number;
  messageCount: number;
  invalidWindowStartedAt: number;
  invalidCount: number;
  signalWindowStartedAt: number;
  signalCount: number;
  lastSignalAt: number;
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

function partyMode(env: PartyEnv): PartyMode {
  return env.PARTY_MODE === "live" ? "live" : "off";
}

function partyGeneration(env: PartyEnv): string {
  const value = (env.PARTY_GENERATION ?? "v1").trim();
  return GENERATION_PATTERN.test(value) ? value : "v1";
}

function allowedOrigins(env: PartyEnv): Set<string> {
  return new Set(
    (env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
}

function isAllowedOrigin(request: Request, env: PartyEnv): boolean {
  const origin = request.headers.get("origin");
  // Origin constrains browser callers; it is not client authentication.
  return origin !== null && allowedOrigins(env).has(origin);
}

function corsHeaders(request: Request, env: PartyEnv): HeadersInit {
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

function hasPartySubprotocol(header: string | null): boolean {
  const protocols = (header ?? "")
    .split(",")
    .map((protocol) => protocol.trim())
    .filter(Boolean);
  return protocols.length === 1 && protocols[0] === PARTY_REALTIME_SUBPROTOCOL;
}

function hasExactPartyQuery(url: URL): boolean {
  let onlyKnownKeys = true;
  url.searchParams.forEach((_value, key) => {
    if (key !== "route" && key !== "sessionId") onlyKnownKeys = false;
  });
  return (
    onlyKnownKeys &&
    url.searchParams.getAll("route").length === 1 &&
    url.searchParams.getAll("sessionId").length <= 1
  );
}

function log(event: string, details: Record<string, number | string> = {}): void {
  console.log(JSON.stringify({ event, ...details }));
}

export default {
  async fetch(request: Request, env: PartyEnv): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return jsonResponse(
        { ok: true, service: "mistakes-party-realtime" },
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

    if (url.pathname !== PARTY_REALTIME_PATH) {
      return jsonResponse(
        { code: "NOT_FOUND", message: "Party route not found." },
        { status: 404 },
        corsHeaders(request, env),
      );
    }
    if (request.method !== "GET") {
      return jsonResponse(
        { code: "METHOD_NOT_ALLOWED", message: "Party presence requires GET." },
        { status: 405 },
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
    if (!hasPartySubprotocol(request.headers.get("sec-websocket-protocol"))) {
      return jsonResponse(
        { code: "BAD_REQUEST", message: "The party WebSocket protocol is required." },
        { status: 400 },
        corsHeaders(request, env),
      );
    }

    if (!hasExactPartyQuery(url)) {
      return jsonResponse(
        { code: "BAD_REQUEST", message: "The party query is invalid." },
        { status: 400 },
        corsHeaders(request, env),
      );
    }

    const route = url.searchParams.get("route");
    if (!isPartyRoute(route)) {
      return jsonResponse(
        { code: "BAD_REQUEST", message: "A canonical public route is required." },
        { status: 400 },
        corsHeaders(request, env),
      );
    }
    const requestedSessionId = url.searchParams.get("sessionId");
    if (requestedSessionId !== null && !isPartySessionId(requestedSessionId)) {
      return jsonResponse(
        { code: "BAD_REQUEST", message: "The party session ID is invalid." },
        { status: 400 },
        corsHeaders(request, env),
      );
    }

    const clientIp = request.headers.get("cf-connecting-ip") ?? "local";
    if (env.PARTY_HANDSHAKE_RATE_LIMITER) {
      try {
        const outcome = await env.PARTY_HANDSHAKE_RATE_LIMITER.limit({
          key: clientIp,
        });
        if (!outcome.success) {
          log("party_handshake_rate_limited");
          return jsonResponse(
            { code: "RATE_LIMITED", message: "Too many party connections." },
            { status: 429 },
            corsHeaders(request, env),
          );
        }
      } catch {
        // The route socket cap remains an amplification bound if the binding fails.
        log("party_handshake_rate_limiter_unavailable");
      }
    }

    const generation = partyGeneration(env);
    return env.PARTY_ROUTES.getByName(
      `party-route:${generation}:${route}`,
    ).fetch(request);
  },
} satisfies ExportedHandler<PartyEnv>;

function partyAttachment(socket: WebSocket): PartySocketAttachment | null {
  try {
    const value = socket.deserializeAttachment() as
      | Partial<PartySocketAttachment>
      | null;
    return value?.version === 1 &&
      isPartySessionId(value.sessionId) &&
      isPartyRoute(value.route) &&
      typeof value.generation === "string" &&
      GENERATION_PATTERN.test(value.generation)
      ? (value as PartySocketAttachment)
      : null;
  } catch {
    return null;
  }
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

function send(socket: WebSocket, message: PartyServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket may close between enumeration and send.
  }
}

function closeWithError(
  socket: WebSocket,
  code: string,
  message: string,
  fatal = false,
  retryAfterMs?: number,
): void {
  send(socket, {
    type: "error",
    code,
    message,
    ...(fatal ? { fatal: true } : {}),
    ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
  });
  if (fatal) {
    try {
      socket.close(1008, code);
    } catch {
      // The peer may already have closed.
    }
  }
}

export class PartyRoute extends DurableObject<PartyEnv> {
  private routeSignalTokens = ROUTE_SIGNAL_BURST;
  private routeSignalRefilledAt = Date.now();

  constructor(ctx: DurableObjectState, env: PartyEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(PARTY_PING_FRAME, PARTY_PONG_FRAME),
    );
  }

  private sockets(except?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter(
        (socket) =>
          socket !== except && isOpen(socket) && partyAttachment(socket) !== null,
      );
  }

  private presenceCount(except?: WebSocket): number {
    return new Set(
      this.sockets(except).map((socket) => partyAttachment(socket)!.sessionId),
    ).size;
  }

  private broadcast(message: PartyServerMessage, except?: WebSocket): void {
    for (const socket of this.sockets(except)) send(socket, message);
  }

  private broadcastPresence(except?: WebSocket): void {
    this.broadcast(
      { type: "presence", presenceCount: this.presenceCount(except) },
      except,
    );
  }

  private consumeRouteSignal(now: number): number {
    const elapsedSeconds = Math.max(
      0,
      (now - this.routeSignalRefilledAt) / 1_000,
    );
    this.routeSignalTokens = Math.min(
      ROUTE_SIGNAL_BURST,
      this.routeSignalTokens + elapsedSeconds * ROUTE_SIGNAL_REFILL_PER_SECOND,
    );
    this.routeSignalRefilledAt = now;
    if (this.routeSignalTokens >= 1) {
      this.routeSignalTokens -= 1;
      return 0;
    }
    return Math.ceil(
      ((1 - this.routeSignalTokens) / ROUTE_SIGNAL_REFILL_PER_SECOND) * 1_000,
    );
  }

  private configurationError(
    socket: WebSocket,
    attachment: PartySocketAttachment,
  ): boolean {
    if (attachment.generation !== partyGeneration(this.env)) {
      closeWithError(
        socket,
        "GENERATION_CHANGED",
        "This party presence generation has ended.",
        true,
      );
      return true;
    }
    if (partyMode(this.env) !== "live") {
      closeWithError(
        socket,
        "PARTY_DISABLED",
        "Party presence is disabled.",
        true,
      );
      return true;
    }
    return false;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = url.searchParams.get("route");
    if (!isPartyRoute(route)) {
      return new Response("Invalid party route", { status: 400 });
    }

    const generation = partyGeneration(this.env);
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    if (partyMode(this.env) !== "live") {
      const now = Date.now();
      server.serializeAttachment({
        version: 1,
        sessionId: crypto.randomUUID(),
        route,
        generation,
        joinedAt: now,
        messageWindowStartedAt: now,
        messageCount: 0,
        invalidWindowStartedAt: now,
        invalidCount: 0,
        signalWindowStartedAt: now,
        signalCount: 0,
        lastSignalAt: 0,
      } satisfies PartySocketAttachment);
      this.ctx.acceptWebSocket(server);
      closeWithError(
        server,
        "PARTY_DISABLED",
        "Party presence is disabled.",
        true,
      );
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "sec-websocket-protocol": PARTY_REALTIME_SUBPROTOCOL },
      });
    }

    const currentSockets = this.sockets();
    if (currentSockets.length >= MAX_ROUTE_SOCKETS) {
      return new Response("Party route is full", { status: 429 });
    }
    const requestedSessionId = url.searchParams.get("sessionId");
    const sessionId = isPartySessionId(requestedSessionId)
      ? requestedSessionId
      : crypto.randomUUID();
    const sessionSocketCount = currentSockets.filter(
      (socket) => partyAttachment(socket)?.sessionId === sessionId,
    ).length;
    if (sessionSocketCount >= MAX_SOCKETS_PER_SESSION) {
      return new Response("Party session has too many connections", {
        status: 429,
      });
    }

    const now = Date.now();
    server.serializeAttachment({
      version: 1,
      sessionId,
      route,
      generation,
      joinedAt: now,
      messageWindowStartedAt: now,
      messageCount: 0,
      invalidWindowStartedAt: now,
      invalidCount: 0,
      signalWindowStartedAt: now,
      signalCount: 0,
      lastSignalAt: 0,
    } satisfies PartySocketAttachment);
    this.ctx.acceptWebSocket(server, [`session:${sessionId}`]);

    send(server, {
      type: "welcome",
      protocolVersion: PARTY_PROTOCOL_VERSION,
      generation,
      route,
      sessionId,
      presenceCount: this.presenceCount(),
    });
    this.broadcastPresence();
    log("party_presence_connected", {
      presenceCount: this.presenceCount(),
      socketCount: this.sockets().length,
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": PARTY_REALTIME_SUBPROTOCOL },
    });
  }

  webSocketMessage(socket: WebSocket, data: string | ArrayBuffer): void {
    const attachment = partyAttachment(socket);
    if (!attachment || this.configurationError(socket, attachment)) return;

    const now = Date.now();
    if (now - attachment.messageWindowStartedAt >= MESSAGE_WINDOW_MS) {
      attachment.messageWindowStartedAt = now;
      attachment.messageCount = 0;
    }
    attachment.messageCount += 1;
    if (attachment.messageCount > MAX_MESSAGES_PER_WINDOW) {
      socket.serializeAttachment(attachment);
      closeWithError(
        socket,
        "RATE_LIMITED",
        "Party messages are arriving too quickly.",
        true,
      );
      return;
    }

    const message = parsePartyClientMessageJson(data);
    if (!message) {
      if (now - attachment.invalidWindowStartedAt >= INVALID_WINDOW_MS) {
        attachment.invalidWindowStartedAt = now;
        attachment.invalidCount = 0;
      }
      attachment.invalidCount += 1;
      socket.serializeAttachment(attachment);
      closeWithError(
        socket,
        "INVALID_MESSAGE",
        "The party message is invalid.",
        attachment.invalidCount >= MAX_INVALID_MESSAGES_PER_WINDOW,
      );
      return;
    }

    if (message.type === "ping") {
      socket.serializeAttachment(attachment);
      send(socket, { type: "pong" });
      return;
    }

    const intervalRemaining =
      attachment.lastSignalAt + MIN_SIGNAL_INTERVAL_MS - now;
    if (intervalRemaining > 0) {
      socket.serializeAttachment(attachment);
      closeWithError(
        socket,
        "RATE_LIMITED",
        "Wait a moment before sending another signal.",
        false,
        Math.min(60_000, intervalRemaining),
      );
      return;
    }
    if (now - attachment.signalWindowStartedAt >= SIGNAL_WINDOW_MS) {
      attachment.signalWindowStartedAt = now;
      attachment.signalCount = 0;
    }
    if (attachment.signalCount >= MAX_SIGNALS_PER_WINDOW) {
      const retryAfterMs = Math.min(
        60_000,
        Math.max(0, attachment.signalWindowStartedAt + SIGNAL_WINDOW_MS - now),
      );
      socket.serializeAttachment(attachment);
      closeWithError(
        socket,
        "RATE_LIMITED",
        "This party session has sent enough signals for now.",
        false,
        retryAfterMs,
      );
      return;
    }
    const routeRetryAfterMs = this.consumeRouteSignal(now);
    if (routeRetryAfterMs > 0) {
      socket.serializeAttachment(attachment);
      closeWithError(
        socket,
        "RATE_LIMITED",
        "This page is cheering too quickly.",
        false,
        Math.min(60_000, routeRetryAfterMs),
      );
      return;
    }

    attachment.lastSignalAt = now;
    attachment.signalCount += 1;
    socket.serializeAttachment(attachment);
    this.broadcast({
      type: "signal",
      id: crypto.randomUUID(),
      kind: message.kind,
      sentAt: now,
    });
  }

  webSocketClose(socket: WebSocket): void {
    this.broadcastPresence(socket);
    log("party_presence_disconnected", {
      presenceCount: this.presenceCount(socket),
      socketCount: this.sockets(socket).length,
    });
  }

  webSocketError(socket: WebSocket): void {
    this.broadcastPresence(socket);
  }
}
