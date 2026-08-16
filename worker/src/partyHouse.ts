import { DurableObject } from "cloudflare:workers";

import {
  PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
  PARTY_HOUSE_PROTOCOL_VERSION,
  PARTY_HOUSE_REALTIME_SUBPROTOCOL,
  isPartyHouseColor,
  isPartyHouseEnergy,
  isPartyHouseGeneration,
  isPartyHouseLightId,
  isPartyHouseZone,
  parsePartyHouseClientMessageJson,
  type PartyHouseAfterglow,
  type PartyHouseClientMessage,
  type PartyHouseColor,
  type PartyHouseLight,
  type PartyHouseMode,
  type PartyHouseServerMessage,
} from "../../app/lib/partyHouseProtocol";

const HOUSE_SOCKET_CAP = 512;
export const PARTY_HOUSE_AFTERGLOW_SESSION_CAP = 2_048;
export const PARTY_HOUSE_GLOBAL_ADMISSION_BURST = 30;
export const PARTY_HOUSE_GLOBAL_ADMISSIONS_PER_MINUTE = 60;
export const PARTY_HOUSE_GLOBAL_EVENT_BURST = 120;
export const PARTY_HOUSE_GLOBAL_EVENTS_PER_SECOND = 60;
const AFTERGLOW_FULL_STRENGTH = 4;
const HOUSE_SOCKETS_PER_SESSION = 2;
const HOUSE_COHORT_SIZE = 12;
const HELLO_TIMEOUT_MS = 10_000;
const MESSAGE_WINDOW_MS = 10_000;
const MAX_MESSAGES_PER_WINDOW = 30;
const INVALID_WINDOW_MS = 10_000;
const MAX_INVALID_MESSAGES_PER_WINDOW = 3;
const MOVE_INTERVAL_MS = 500;
const KNOCK_INTERVAL_MS = 4_000;
const KNOCK_WINDOW_MS = 60_000;
const MAX_KNOCKS_PER_WINDOW = 12;
const HOUSE_KNOCK_BURST_MILLI = 8_000;
const HOUSE_KNOCK_REFILL_MILLI_PER_MS = 4;
const HOUSE_ADMISSION_BURST_MILLI =
  PARTY_HOUSE_GLOBAL_ADMISSION_BURST * 1_000;
const HOUSE_ADMISSION_REFILL_MILLI_PER_MS =
  (PARTY_HOUSE_GLOBAL_ADMISSIONS_PER_MINUTE * 1_000) / 60_000;
const HOUSE_EVENT_BURST_MILLI = PARTY_HOUSE_GLOBAL_EVENT_BURST * 1_000;
const HOUSE_EVENT_REFILL_MILLI_PER_MS =
  (PARTY_HOUSE_GLOBAL_EVENTS_PER_SECOND * 1_000) / 1_000;
const AFTERGLOW_ACTIVE_REFRESH_MS = 15 * 60_000;
const HOUSE_PING_FRAME = JSON.stringify({ type: "ping" });
const HOUSE_PONG_FRAME = JSON.stringify({ type: "pong" });
const SESSION_HASH_PATTERN = /^[A-Za-z0-9_-]{43}$/;
type PartyEnv = GeneratedPartyEnv;

type HouseMode = "off" | PartyHouseMode;

interface HouseSocketAttachment {
  version: 2;
  initialized: boolean;
  connectedAt: number;
  helloDeadlineAt: number;
  messageWindowStartedAt: number;
  messageCount: number;
  invalidWindowStartedAt: number;
  invalidCount: number;
  generation?: string;
  mode?: PartyHouseMode;
  sessionHash?: string;
  lightId?: string;
  color?: PartyHouseColor;
  seed?: number;
  zone?: PartyHouseLight["zone"];
  energy?: PartyHouseLight["energy"];
  sharing?: boolean;
  activityAt?: number;
  lastMoveAt?: number;
  knockWindowStartedAt?: number;
  knockCount?: number;
  lastKnockAt?: number;
}

interface AfterglowRow {
  [key: string]: SqlStorageValue;
  session_hash: string;
  color: number;
  arrival_at: number | null;
  knock_at: number | null;
}

interface HouseLimitRow {
  [key: string]: SqlStorageValue;
  knock_tokens_milli: number;
  knock_refilled_at: number;
}

interface HouseAdmissionLimitRow {
  [key: string]: SqlStorageValue;
  tokens_milli: number;
  refilled_at: number;
}

function houseMode(env: PartyEnv): HouseMode {
  const value: string = env.PARTY_HOUSE_MODE;
  return value === "live" || value === "presence" ? value : "off";
}

function houseGeneration(env: PartyEnv): string {
  const value = (env.PARTY_GENERATION ?? "v1").trim();
  return isPartyHouseGeneration(value) ? value : "v1";
}

function isOpen(socket: WebSocket): boolean {
  return socket.readyState === WebSocket.OPEN;
}

function sendHouse(socket: WebSocket, message: PartyHouseServerMessage): void {
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket can close after enumeration and before the send completes.
  }
}

function closeHouse(
  socket: WebSocket,
  code: string,
  fatal: boolean,
): void {
  sendHouse(socket, { type: "error", code, fatal });
  if (!fatal) return;
  try {
    socket.close(1008, code);
  } catch {
    // The peer may already have closed.
  }
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
  );
}

async function deriveHouseIdentity(
  generation: string,
  sessionId: string,
): Promise<{
  sessionHash: string;
  lightId: string;
  color: PartyHouseColor;
  seed: number;
}> {
  const [publicDigest, storageDigest] = await Promise.all([
    sha256(`mistakes.party/house/light/v2\0${generation}\0${sessionId}`),
    sha256(`mistakes.party/house/storage/v2\0${generation}\0${sessionId}`),
  ]);
  const seed = new DataView(
    publicDigest.buffer,
    publicDigest.byteOffset + 13,
    4,
  ).getUint32(0, false);
  return {
    sessionHash: base64Url(storageDigest),
    lightId: base64Url(publicDigest.slice(0, 12)),
    color: (publicDigest[12] % 4) as PartyHouseColor,
    seed,
  };
}

function attachment(socket: WebSocket): HouseSocketAttachment | null {
  try {
    const value = socket.deserializeAttachment() as
      | Partial<HouseSocketAttachment>
      | null;
    if (
      value?.version !== 2 ||
      typeof value.initialized !== "boolean" ||
      !Number.isSafeInteger(value.connectedAt) ||
      !Number.isSafeInteger(value.helloDeadlineAt) ||
      !Number.isSafeInteger(value.messageWindowStartedAt) ||
      !Number.isSafeInteger(value.messageCount) ||
      !Number.isSafeInteger(value.invalidWindowStartedAt) ||
      !Number.isSafeInteger(value.invalidCount)
    ) {
      return null;
    }
    if (!value.initialized) return value as HouseSocketAttachment;
    return typeof value.sessionHash === "string" &&
      SESSION_HASH_PATTERN.test(value.sessionHash) &&
      isPartyHouseGeneration(value.generation) &&
      (value.mode === "presence" || value.mode === "live") &&
      isPartyHouseLightId(value.lightId) &&
      isPartyHouseColor(value.color) &&
      typeof value.seed === "number" &&
      Number.isSafeInteger(value.seed) &&
      value.seed >= 0 &&
      value.seed <= 0xffff_ffff &&
      isPartyHouseZone(value.zone) &&
      isPartyHouseEnergy(value.energy) &&
      typeof value.sharing === "boolean" &&
      Number.isSafeInteger(value.activityAt) &&
      Number.isSafeInteger(value.lastMoveAt) &&
      Number.isSafeInteger(value.knockWindowStartedAt) &&
      Number.isSafeInteger(value.knockCount) &&
      Number.isSafeInteger(value.lastKnockAt)
      ? (value as HouseSocketAttachment)
      : null;
  } catch {
    return null;
  }
}

function lightFromAttachment(value: HouseSocketAttachment): PartyHouseLight {
  return {
    id: value.lightId!,
    color: value.color!,
    seed: value.seed!,
    zone: value.zone!,
    energy: value.energy!,
    sharing: value.sharing!,
  };
}

function normalizeWeights(raw: readonly number[]): [number, number, number, number] {
  const total = raw.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return [0, 0, 0, 0];

  const scaled = raw.map((value, color) => {
    const exact = (value / total) * 1_000;
    const floor = Math.floor(exact);
    return { color, floor, fraction: exact - floor };
  });
  const remaining = 1_000 - scaled.reduce((sum, value) => sum + value.floor, 0);
  const order = [...scaled].sort(
    (left, right) => right.fraction - left.fraction || left.color - right.color,
  );
  for (let index = 0; index < remaining; index += 1) {
    order[index % order.length].floor += 1;
  }
  const byColor = scaled.sort((left, right) => left.color - right.color);
  return [byColor[0].floor, byColor[1].floor, byColor[2].floor, byColor[3].floor];
}

export function partyHouseDisabledUpgrade(): Response {
  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();
  closeHouse(server, "PARTY_DISABLED", true);
  return new Response(null, {
    status: 101,
    webSocket: client,
    headers: { "sec-websocket-protocol": PARTY_HOUSE_REALTIME_SUBPROTOCOL },
  });
}

export class PartyHouse extends DurableObject<PartyEnv> {
  private admissionTokensMilli = 0;
  private admissionRefilledAt = 0;
  private eventTokensMilli = HOUSE_EVENT_BURST_MILLI;
  private eventRefilledAt = Date.now();

  constructor(ctx: DurableObjectState, env: PartyEnv) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(
      new WebSocketRequestResponsePair(HOUSE_PING_FRAME, HOUSE_PONG_FRAME),
    );
    void this.ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS _house_schema_migrations (
        id INTEGER PRIMARY KEY,
        applied_at INTEGER NOT NULL
      );
    `);
    const version = this.ctx.storage.sql
      .exec<{ version: number }>(
        "SELECT COALESCE(MAX(id), 0) AS version FROM _house_schema_migrations",
      )
      .one().version;
    const now = Date.now();
    if (version < 1) {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS afterglow_sessions (
          session_hash TEXT PRIMARY KEY,
          color INTEGER NOT NULL CHECK (color BETWEEN 0 AND 3),
          arrival_at INTEGER,
          knock_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS afterglow_arrival_idx
          ON afterglow_sessions(arrival_at);
        CREATE INDEX IF NOT EXISTS afterglow_knock_idx
          ON afterglow_sessions(knock_at);
        CREATE TABLE IF NOT EXISTS house_limits (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          knock_tokens_milli INTEGER NOT NULL,
          knock_refilled_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO house_limits
          (id, knock_tokens_milli, knock_refilled_at)
          VALUES (1, ${HOUSE_KNOCK_BURST_MILLI}, ${now});
        INSERT INTO _house_schema_migrations (id, applied_at) VALUES (1, ${now});
      `);
    }

    if (version < 2) {
      // The afterglow is decorative. Keep the newest bounded set and enforce
      // the cap in SQLite so no code path can create unbounded storage or
      // increasingly expensive scans during connection churn.
      this.ctx.storage.sql.exec(`
        DELETE FROM afterglow_sessions
        WHERE session_hash NOT IN (
          SELECT session_hash
          FROM afterglow_sessions
          ORDER BY MAX(COALESCE(arrival_at, 0), COALESCE(knock_at, 0)) DESC
          LIMIT ${PARTY_HOUSE_AFTERGLOW_SESSION_CAP}
        );
        CREATE TRIGGER IF NOT EXISTS afterglow_sessions_cap
        BEFORE INSERT ON afterglow_sessions
        WHEN (SELECT COUNT(*) FROM afterglow_sessions) >= ${PARTY_HOUSE_AFTERGLOW_SESSION_CAP}
        BEGIN
          SELECT RAISE(IGNORE);
        END;
        INSERT INTO _house_schema_migrations (id, applied_at) VALUES (2, ${now});
      `);
    }

    if (version < 3) {
      // Unlike the edge Rate Limiting binding, this bucket is coordinated by
      // the single house Durable Object and therefore applies across every
      // Cloudflare location. Persist it so eviction cannot reset admission.
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS house_admission_limit (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          tokens_milli INTEGER NOT NULL,
          refilled_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO house_admission_limit
          (id, tokens_milli, refilled_at)
          VALUES (1, ${HOUSE_ADMISSION_BURST_MILLI}, ${now});
        INSERT INTO _house_schema_migrations (id, applied_at) VALUES (3, ${now});
      `);
    }

    const admission = this.ctx.storage.sql
      .exec<HouseAdmissionLimitRow>(
        "SELECT tokens_milli, refilled_at FROM house_admission_limit WHERE id = 1",
      )
      .one();
    this.admissionTokensMilli = admission.tokens_milli;
    this.admissionRefilledAt = admission.refilled_at;
  }

  private allSockets(except?: WebSocket): WebSocket[] {
    return this.ctx
      .getWebSockets()
      .filter((socket) => socket !== except && isOpen(socket));
  }

  private initializedSockets(except?: WebSocket): WebSocket[] {
    return this.allSockets(except).filter(
      (socket) => attachment(socket)?.initialized === true,
    );
  }

  private sessionSockets(sessionHash: string, except?: WebSocket): WebSocket[] {
    return this.initializedSockets(except).filter(
      (socket) => attachment(socket)?.sessionHash === sessionHash,
    );
  }

  private sessions(except?: WebSocket): Map<string, HouseSocketAttachment> {
    const sessions = new Map<string, HouseSocketAttachment>();
    for (const socket of this.initializedSockets(except)) {
      const current = attachment(socket)!;
      const existing = sessions.get(current.sessionHash!);
      if (
        !existing ||
        current.activityAt! > existing.activityAt! ||
        (current.activityAt === existing.activityAt &&
          current.lightId! < existing.lightId!)
      ) {
        sessions.set(current.sessionHash!, current);
      }
    }
    return sessions;
  }

  private cohort(except?: WebSocket): PartyHouseLight[] {
    return [...this.sessions(except).values()]
      .sort(
        (left, right) =>
          right.activityAt! - left.activityAt! ||
          left.lightId!.localeCompare(right.lightId!),
      )
      .slice(0, HOUSE_COHORT_SIZE)
      .map(lightFromAttachment);
  }

  private sendToAll(message: PartyHouseServerMessage, except?: WebSocket): void {
    for (const socket of this.initializedSockets(except)) {
      sendHouse(socket, message);
    }
  }

  private snapshot(
    afterglow: PartyHouseAfterglow,
    except?: WebSocket,
  ): PartyHouseServerMessage {
    return {
      type: "house:snapshot",
      presenceCount: this.sessions(except).size,
      lights: this.cohort(except),
      afterglow,
    };
  }

  private broadcastSnapshot(
    afterglow: PartyHouseAfterglow,
    except?: WebSocket,
  ): void {
    this.sendToAll(this.snapshot(afterglow, except), except);
  }

  private cleanAfterglow(now: number): void {
    const cutoff = now - PARTY_HOUSE_AFTERGLOW_WINDOW_MS;
    this.ctx.storage.sql.exec(
      "UPDATE afterglow_sessions SET arrival_at = NULL WHERE arrival_at IS NOT NULL AND arrival_at <= ?",
      cutoff,
    );
    this.ctx.storage.sql.exec(
      "UPDATE afterglow_sessions SET knock_at = NULL WHERE knock_at IS NOT NULL AND knock_at <= ?",
      cutoff,
    );
    this.ctx.storage.sql.exec(
      "DELETE FROM afterglow_sessions WHERE arrival_at IS NULL AND knock_at IS NULL",
    );
  }

  private recomputeAfterglow(now: number): PartyHouseAfterglow {
    this.cleanAfterglow(now);
    const rawWeights = [0, 0, 0, 0];
    let total = 0;
    const rows = this.ctx.storage.sql
      .exec<AfterglowRow>(
        "SELECT session_hash, color, arrival_at, knock_at FROM afterglow_sessions",
      )
      .toArray();
    for (const row of rows) {
      let contribution = 0;
      if (row.arrival_at !== null) {
        contribution += Math.max(
          0,
          1 - (now - row.arrival_at) / PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
        );
      }
      if (row.knock_at !== null) {
        contribution +=
          3 *
          Math.max(
            0,
            1 - (now - row.knock_at) / PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
          );
      }
      rawWeights[row.color] += contribution;
      total += contribution;
    }
    const afterglow: PartyHouseAfterglow = {
      weights: normalizeWeights(rawWeights),
      intensity: Math.min(
        1_000,
        Math.round((total / AFTERGLOW_FULL_STRENGTH) * 1_000),
      ),
      asOf: now,
      windowMs: PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
    };
    return afterglow;
  }

  private recordArrival(
    sessionHash: string,
    color: PartyHouseColor,
    now: number,
  ): void {
    const existing = this.ctx.storage.sql
      .exec<AfterglowRow>(
        "SELECT session_hash, color, arrival_at, knock_at FROM afterglow_sessions WHERE session_hash = ?",
        sessionHash,
      )
      .toArray()[0];
    if (!existing) {
      this.ctx.storage.sql.exec(
        "INSERT INTO afterglow_sessions (session_hash, color, arrival_at, knock_at) VALUES (?, ?, ?, NULL)",
        sessionHash,
        color,
        now,
      );
      return;
    }
    if (
      existing.arrival_at === null ||
      existing.arrival_at <= now - PARTY_HOUSE_AFTERGLOW_WINDOW_MS
    ) {
      this.ctx.storage.sql.exec(
        "UPDATE afterglow_sessions SET color = ?, arrival_at = ? WHERE session_hash = ?",
        color,
        now,
        sessionHash,
      );
    }
  }

  private recordFirstKnock(
    sessionHash: string,
    color: PartyHouseColor,
    now: number,
  ): void {
    const existing = this.ctx.storage.sql
      .exec<AfterglowRow>(
        "SELECT session_hash, color, arrival_at, knock_at FROM afterglow_sessions WHERE session_hash = ?",
        sessionHash,
      )
      .toArray()[0];
    if (!existing) {
      this.ctx.storage.sql.exec(
        "INSERT INTO afterglow_sessions (session_hash, color, arrival_at, knock_at) VALUES (?, ?, NULL, ?)",
        sessionHash,
        color,
        now,
      );
      return;
    }
    if (
      existing.knock_at === null ||
      existing.knock_at <= now - PARTY_HOUSE_AFTERGLOW_WINDOW_MS
    ) {
      this.ctx.storage.sql.exec(
        "UPDATE afterglow_sessions SET color = ?, knock_at = ? WHERE session_hash = ?",
        color,
        now,
        sessionHash,
      );
    }
  }

  private consumeHouseKnock(now: number): boolean {
    const state = this.ctx.storage.sql
      .exec<HouseLimitRow>(
        "SELECT knock_tokens_milli, knock_refilled_at FROM house_limits WHERE id = 1",
      )
      .one();
    const tokens = Math.min(
      HOUSE_KNOCK_BURST_MILLI,
      state.knock_tokens_milli +
        Math.max(0, now - state.knock_refilled_at) *
          HOUSE_KNOCK_REFILL_MILLI_PER_MS,
    );
    const accepted = tokens >= 1_000;
    this.ctx.storage.sql.exec(
      "UPDATE house_limits SET knock_tokens_milli = ?, knock_refilled_at = ? WHERE id = 1",
      accepted ? tokens - 1_000 : tokens,
      now,
    );
    return accepted;
  }

  private consumeHouseAdmission(now: number): boolean {
    const tokens = Math.min(
      HOUSE_ADMISSION_BURST_MILLI,
      this.admissionTokensMilli +
        Math.max(0, now - this.admissionRefilledAt) *
          HOUSE_ADMISSION_REFILL_MILLI_PER_MS,
    );
    if (tokens < 1_000) {
      // Avoid turning rejected attack traffic into a SQLite I/O amplifier.
      // On eviction, the persisted state derives the same refill from time.
      this.admissionTokensMilli = tokens;
      this.admissionRefilledAt = now;
      return false;
    }
    const remaining = tokens - 1_000;
    this.ctx.storage.sql.exec(
      "UPDATE house_admission_limit SET tokens_milli = ?, refilled_at = ? WHERE id = 1",
      remaining,
      now,
    );
    this.admissionTokensMilli = remaining;
    this.admissionRefilledAt = now;
    return true;
  }

  private consumeHouseEvent(now: number): boolean {
    const tokens = Math.min(
      HOUSE_EVENT_BURST_MILLI,
      this.eventTokensMilli +
        Math.max(0, now - this.eventRefilledAt) *
          HOUSE_EVENT_REFILL_MILLI_PER_MS,
    );
    this.eventRefilledAt = now;
    if (tokens < 1_000) {
      this.eventTokensMilli = tokens;
      return false;
    }
    this.eventTokensMilli = tokens - 1_000;
    return true;
  }

  private earliestAfterglowExpiry(now: number): number | null {
    const earliestArrival = this.ctx.storage.sql
      .exec<{ value: number | null }>(
        "SELECT MIN(arrival_at) AS value FROM afterglow_sessions WHERE arrival_at IS NOT NULL",
      )
      .one().value;
    const earliestKnock = this.ctx.storage.sql
      .exec<{ value: number | null }>(
        "SELECT MIN(knock_at) AS value FROM afterglow_sessions WHERE knock_at IS NOT NULL",
      )
      .one().value;
    const timestamps = [earliestArrival, earliestKnock].filter(
      (value): value is number => value !== null,
    );
    if (timestamps.length === 0) return null;
    return Math.max(
      now + 1,
      Math.min(...timestamps) + PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
    );
  }

  private async scheduleNextAlarm(now: number): Promise<void> {
    const candidates: number[] = [];
    for (const socket of this.allSockets()) {
      const current = attachment(socket);
      if (current && !current.initialized) {
        candidates.push(Math.max(now + 1, current.helloDeadlineAt));
      }
    }
    if (this.initializedSockets().length > 0) {
      candidates.push(now + AFTERGLOW_ACTIVE_REFRESH_MS);
    }
    const expiry = this.earliestAfterglowExpiry(now);
    if (expiry !== null) candidates.push(expiry);

    if (candidates.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...candidates));
  }

  private registerInvalid(
    socket: WebSocket,
    current: HouseSocketAttachment,
    now: number,
  ): void {
    if (now - current.invalidWindowStartedAt >= INVALID_WINDOW_MS) {
      current.invalidWindowStartedAt = now;
      current.invalidCount = 0;
    }
    current.invalidCount += 1;
    socket.serializeAttachment(current);
    closeHouse(
      socket,
      "INVALID_MESSAGE",
      current.invalidCount >= MAX_INVALID_MESSAGES_PER_WINDOW,
    );
  }

  private registerValid(
    socket: WebSocket,
    current: HouseSocketAttachment,
    now: number,
  ): boolean {
    if (now - current.messageWindowStartedAt >= MESSAGE_WINDOW_MS) {
      current.messageWindowStartedAt = now;
      current.messageCount = 0;
    }
    current.messageCount += 1;
    socket.serializeAttachment(current);
    if (current.messageCount <= MAX_MESSAGES_PER_WINDOW) return true;
    closeHouse(socket, "RATE_LIMITED", true);
    return false;
  }

  private configurationAllows(
    socket: WebSocket,
    current: HouseSocketAttachment,
  ): PartyHouseMode | null {
    const generation = houseGeneration(this.env);
    if (
      current.initialized &&
      current.generation !== generation
    ) {
      closeHouse(socket, "GENERATION_CHANGED", true);
      return null;
    }
    const mode = houseMode(this.env);
    if (mode === "off") {
      closeHouse(socket, "PARTY_DISABLED", true);
      return null;
    }
    if (current.initialized && current.mode !== mode) {
      closeHouse(socket, "MODE_CHANGED", true);
      return null;
    }
    return mode;
  }

  async fetch(): Promise<Response> {
    const now = Date.now();

    if (houseMode(this.env) === "off") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
      server.serializeAttachment({
        version: 2,
        initialized: false,
        connectedAt: now,
        helloDeadlineAt: now,
        messageWindowStartedAt: now,
        messageCount: 0,
        invalidWindowStartedAt: now,
        invalidCount: 0,
      } satisfies HouseSocketAttachment);
      this.ctx.acceptWebSocket(server);
      closeHouse(server, "PARTY_DISABLED", true);
      return new Response(null, {
        status: 101,
        webSocket: client,
        headers: { "sec-websocket-protocol": PARTY_HOUSE_REALTIME_SUBPROTOCOL },
      });
    }

    if (this.allSockets().length >= HOUSE_SOCKET_CAP) {
      return new Response("Party house is full.", {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": "30",
        },
      });
    }

    if (!this.consumeHouseAdmission(now)) {
      return new Response("Party house admission is busy.", {
        status: 429,
        headers: {
          "cache-control": "no-store",
          "retry-after": "1",
        },
      });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];

    server.serializeAttachment({
      version: 2,
      initialized: false,
      connectedAt: now,
      helloDeadlineAt: now + HELLO_TIMEOUT_MS,
      messageWindowStartedAt: now,
      messageCount: 0,
      invalidWindowStartedAt: now,
      invalidCount: 0,
    } satisfies HouseSocketAttachment);
    this.ctx.acceptWebSocket(server);
    await this.scheduleNextAlarm(now);

    return new Response(null, {
      status: 101,
      webSocket: client,
      headers: { "sec-websocket-protocol": PARTY_HOUSE_REALTIME_SUBPROTOCOL },
    });
  }

  private async handleHello(
    socket: WebSocket,
    current: HouseSocketAttachment,
    message: Extract<PartyHouseClientMessage, { type: "house:hello" }>,
    mode: PartyHouseMode,
    now: number,
  ): Promise<void> {
    if (current.initialized) {
      closeHouse(socket, "HELLO_ALREADY_RECEIVED", true);
      return;
    }
    const generation = houseGeneration(this.env);
    const sessionId =
      message.generation === generation && message.sessionId !== null
        ? message.sessionId
        : crypto.randomUUID();
    const identity = await deriveHouseIdentity(generation, sessionId);
    // Hashing yields to the event loop. Re-read the attachment before mutating
    // membership so concurrent frames cannot initialize a socket twice or
    // record an arrival after another frame closed it.
    const fresh = attachment(socket);
    if (!isOpen(socket) || !fresh) return;
    if (fresh.initialized) {
      closeHouse(socket, "HELLO_ALREADY_RECEIVED", true);
      return;
    }
    const peers = this.sessionSockets(identity.sessionHash, socket);
    if (peers.length >= HOUSE_SOCKETS_PER_SESSION) {
      closeHouse(socket, "SESSION_LIMIT", true);
      return;
    }

    const representative = peers.length > 0 ? attachment(peers[0])! : null;
    const distinctJoin = representative === null;
    const initialized: HouseSocketAttachment = {
      ...fresh,
      initialized: true,
      helloDeadlineAt: 0,
      generation,
      mode,
      sessionHash: identity.sessionHash,
      lightId: identity.lightId,
      color: identity.color,
      seed: identity.seed,
      zone: representative?.zone ?? 4,
      energy: representative?.energy ?? 0,
      sharing: representative?.sharing ?? false,
      activityAt: representative?.activityAt ?? now,
      lastMoveAt: 0,
      knockWindowStartedAt: representative?.knockWindowStartedAt ?? now,
      knockCount: representative?.knockCount ?? 0,
      lastKnockAt: representative?.lastKnockAt ?? 0,
    };
    socket.serializeAttachment(initialized);

    if (distinctJoin) this.recordArrival(identity.sessionHash, identity.color, now);
    const afterglow = this.recomputeAfterglow(now);
    await this.scheduleNextAlarm(now);
    sendHouse(socket, {
      type: "house:welcome",
      protocolVersion: PARTY_HOUSE_PROTOCOL_VERSION,
      generation,
      mode,
      sessionId,
      self: lightFromAttachment(initialized),
      presenceCount: this.sessions().size,
      lights: this.cohort(),
      afterglow,
    });
    if (distinctJoin) this.broadcastSnapshot(afterglow);
  }

  private handleMove(
    socket: WebSocket,
    current: HouseSocketAttachment,
    message: Extract<PartyHouseClientMessage, { type: "light:move" }>,
    now: number,
  ): void {
    if (!current.sharing && !message.sharing) return;
    const privacyReducingMove = current.sharing === true && !message.sharing;
    const zone = privacyReducingMove ? 4 : message.zone;
    const energy = privacyReducingMove ? 0 : message.energy;
    if (
      current.zone === zone &&
      current.energy === energy &&
      current.sharing === message.sharing
    ) {
      return;
    }
    if (!privacyReducingMove && now - current.lastMoveAt! < MOVE_INTERVAL_MS) {
      closeHouse(socket, "RATE_LIMITED", false);
      return;
    }

    for (const peer of this.sessionSockets(current.sessionHash!)) {
      const peerState = attachment(peer)!;
      peerState.zone = zone;
      peerState.energy = energy;
      peerState.sharing = message.sharing;
      if (peer === socket && !privacyReducingMove) peerState.lastMoveAt = now;
      peer.serializeAttachment(peerState);
    }
    const visible = this.cohort().some((light) => light.id === current.lightId);
    if (visible) {
      this.sendToAll({
        type: "light:move",
        lightId: current.lightId!,
        zone,
        energy,
        sharing: message.sharing,
      });
    }
  }

  private async handleKnock(
    socket: WebSocket,
    current: HouseSocketAttachment,
    message: Extract<PartyHouseClientMessage, { type: "knock:send" }>,
    now: number,
  ): Promise<void> {
    const peers = this.sessionSockets(current.sessionHash!);
    const representative = attachment(peers[0]) ?? current;
    if (now - representative.lastKnockAt! < KNOCK_INTERVAL_MS) {
      closeHouse(socket, "RATE_LIMITED", false);
      return;
    }
    let windowStartedAt = representative.knockWindowStartedAt!;
    let count = representative.knockCount!;
    if (now - windowStartedAt >= KNOCK_WINDOW_MS) {
      windowStartedAt = now;
      count = 0;
    }
    if (count >= MAX_KNOCKS_PER_WINDOW || !this.consumeHouseKnock(now)) {
      closeHouse(socket, "RATE_LIMITED", false);
      return;
    }

    for (const peer of peers) {
      const peerState = attachment(peer)!;
      peerState.zone = message.zone;
      peerState.activityAt = now;
      peerState.lastKnockAt = now;
      peerState.knockWindowStartedAt = windowStartedAt;
      peerState.knockCount = count + 1;
      peer.serializeAttachment(peerState);
    }
    this.recordFirstKnock(current.sessionHash!, current.color!, now);
    const afterglow = this.recomputeAfterglow(now);
    await this.scheduleNextAlarm(now);
    this.sendToAll({
      type: "knock",
      eventId: crypto.randomUUID(),
      requestId: message.requestId,
      lightId: current.lightId!,
      color: current.color!,
      zone: message.zone,
      sentAt: now,
    });
    this.broadcastSnapshot(afterglow);
  }

  async webSocketMessage(
    socket: WebSocket,
    data: string | ArrayBuffer,
  ): Promise<void> {
    const current = attachment(socket);
    if (!current) {
      closeHouse(socket, "INVALID_SESSION", true);
      return;
    }
    const now = Date.now();
    if (!current.initialized && current.helloDeadlineAt <= now) {
      closeHouse(socket, "HELLO_TIMEOUT", true);
      return;
    }
    // Exact heartbeat frames are handled by setWebSocketAutoResponse and do
    // not enter this handler. Every other frame shares one house-wide budget,
    // so hundreds of sockets cannot multiply their individual allowances.
    if (!this.consumeHouseEvent(now)) {
      closeHouse(socket, "RATE_LIMITED", true);
      return;
    }
    const message = parsePartyHouseClientMessageJson(data);
    if (!message) {
      this.registerInvalid(socket, current, now);
      return;
    }
    if (!this.registerValid(socket, current, now)) return;
    const mode = this.configurationAllows(socket, current);
    if (!mode) return;

    if (!current.initialized) {
      if (message.type !== "house:hello") {
        closeHouse(socket, "HELLO_REQUIRED", true);
        return;
      }
      await this.handleHello(socket, current, message, mode, now);
      return;
    }
    if (message.type === "house:hello") {
      closeHouse(socket, "HELLO_ALREADY_RECEIVED", true);
      return;
    }
    if (message.type === "ping") {
      sendHouse(socket, { type: "pong" });
      return;
    }
    if (mode === "presence") {
      closeHouse(socket, "MODE_DISABLED", false);
      return;
    }
    if (message.type === "light:move") {
      this.handleMove(socket, current, message, now);
      return;
    }
    await this.handleKnock(socket, current, message, now);
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    const current = attachment(socket);
    const now = Date.now();
    if (
      current?.initialized &&
      this.sessionSockets(current.sessionHash!, socket).length === 0
    ) {
      const afterglow = this.recomputeAfterglow(now);
      this.broadcastSnapshot(afterglow, socket);
    }
    await this.scheduleNextAlarm(now);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.webSocketClose(socket);
  }

  async alarm(): Promise<void> {
    const now = Date.now();
    for (const socket of this.allSockets()) {
      const current = attachment(socket);
      if (current && !current.initialized && current.helloDeadlineAt <= now) {
        closeHouse(socket, "HELLO_TIMEOUT", true);
      }
    }
    const afterglow = this.recomputeAfterglow(now);
    if (this.initializedSockets().length > 0) {
      this.broadcastSnapshot(afterglow);
    }
    await this.scheduleNextAlarm(now);
  }
}
