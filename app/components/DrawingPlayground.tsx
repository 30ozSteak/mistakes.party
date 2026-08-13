"use client";

import { usePathname } from "next/navigation";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  anchoredBoundsToDocumentBounds,
  anchoredPointToDocumentPoint,
  anchoredPointsToDocumentPoints,
  documentPointToAnchoredPoint,
} from "../lib/drawingAnchors";
import {
  clearStrokes,
  DEFAULT_COLOR,
  type DrawingPreferences,
  hasPreferenceStorageAccess,
  type HighlighterColor,
  loadStrokes,
  normalizeRoute,
  PALETTE,
  readPreferences,
  saveStroke,
  type StrokeRecord,
  writePreferences,
} from "./drawingStorage";
import {
  createDrawingRoomId,
  type DrawingClientMessage,
  type DrawingParticipant,
  DRAWING_ROOM_MAX_POINTS_PER_MESSAGE,
  type DrawingServerMessage,
  type DrawingSharedStroke,
  DRAWING_STROKE_OPACITY,
  DRAWING_STROKE_WIDTH,
  drawingRoomWebSocketProtocols,
  drawingRoomWebSocketUrl,
  isDrawingParticipantId,
  isDrawingParticipantName,
  isDrawingParticipantToken,
  isDrawingRoomId,
  isPublicDrawingRoute,
  parseDrawingServerMessageJson,
} from "../lib/drawingRealtimeProtocol";
import { DRAWING_REALTIME_URL } from "../lib/drawingRealtimeConfig";
import {
  dismissPublicNudge,
  type DrawingScope,
  isPublicNudgeDismissed,
  type PersistedDrawingScope,
  resolveInitialDrawingScope,
  writePersistedDrawingScope,
} from "./publicDrawingPreferences";
import {
  type PublicDrawingController,
  usePublicDrawing,
} from "./usePublicDrawing";

const STROKE_WIDTH = DRAWING_STROKE_WIDTH;
const STROKE_OPACITY = DRAWING_STROKE_OPACITY;
const SAMPLE_DISTANCE = 3;
const PUBLIC_SCROLL_SAMPLE_DISTANCE = STROKE_WIDTH / 2;
const IDLE_BREAK_MS = 150;
const CHECKPOINT_INTERVAL_MS = 1_000;
const CLEAR_CONFIRMATION_MS = 5_000;
const PARTY_SEND_INTERVAL_MS = 50;
const PUBLIC_CURSOR_LABEL_MS = 2_000;
const PARTY_SESSION_KEY = "mistakes-party.drawing.party.v1";
const PARTY_IDENTITY_KEY_PREFIX = "mistakes-party.drawing.participant.v2.";
const LEGACY_PARTY_IDENTITY_KEY = "mistakes-party.drawing.participant.v1";
const PARTY_REALTIME_URL = DRAWING_REALTIME_URL;

const PARTY_ADJECTIVES = [
  "Acid",
  "Electric",
  "Hot",
  "Wonky",
  "Neon",
  "Lucky",
] as const;
const PARTY_CREATURES = [
  "Moth",
  "Pigeon",
  "Possum",
  "Snail",
  "Goblin",
  "Raccoon",
] as const;

type PartyConnectionState =
  | "solo"
  | "connecting"
  | "syncing"
  | "clearing"
  | "live"
  | "reconnecting"
  | "full"
  | "unavailable"
  | "offline";

type PartyIdentity = {
  id: string;
  name: string;
  token: string;
};

type RemoteCursor = {
  authorId: string;
  authorName: string;
  route: string;
  x: number;
  y: number;
  color: HighlighterColor;
  visible: boolean;
};

type Point = {
  x: number;
  y: number;
};

type ViewportPointer = Point & {
  documentX: number;
  documentY: number;
  pointerId: number;
};

function copyStroke(stroke: StrokeRecord): StrokeRecord {
  return {
    ...stroke,
    points: [...stroke.points],
    bounds: { ...stroke.bounds },
  };
}

function createStrokeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function partyIdentityStorageKey(roomId: string): string {
  return `${PARTY_IDENTITY_KEY_PREFIX}${roomId}`;
}

function discardLegacyPartyIdentity() {
  try {
    window.localStorage.removeItem(LEGACY_PARTY_IDENTITY_KEY);
  } catch {
    // Legacy storage may be unavailable; it is never read or reused.
  }
}

function readPartyIdentity(roomId: string): PartyIdentity | null {
  try {
    const parsed = JSON.parse(
      window.sessionStorage.getItem(partyIdentityStorageKey(roomId)) ?? "null",
    ) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      "name" in parsed &&
      "token" in parsed &&
      isDrawingParticipantId(parsed.id) &&
      isDrawingParticipantName(parsed.name) &&
      isDrawingParticipantToken(parsed.token)
    ) {
      return { id: parsed.id, name: parsed.name, token: parsed.token };
    }
  } catch {
    // A malformed identity is replaced without affecting private drawings.
  }

  return null;
}

function createPartyIdentity(roomId: string): PartyIdentity {
  const id = createDrawingRoomId();
  const token = createDrawingRoomId();
  const name = `${
    PARTY_ADJECTIVES[Math.floor(Math.random() * PARTY_ADJECTIVES.length)]
  } ${PARTY_CREATURES[Math.floor(Math.random() * PARTY_CREATURES.length)]}`;
  const identity = { id, name, token };
  storePartyIdentity(roomId, identity);
  return identity;
}

function storePartyIdentity(roomId: string, identity: PartyIdentity) {
  try {
    window.sessionStorage.setItem(
      partyIdentityStorageKey(roomId),
      JSON.stringify(identity),
    );
  } catch {
    // The in-memory identity still keeps the current party usable.
  }
}

function readOrCreatePartyIdentity(roomId: string): PartyIdentity {
  return readPartyIdentity(roomId) ?? createPartyIdentity(roomId);
}

function partyStatusLabel(state: PartyConnectionState): string {
  switch (state) {
    case "connecting":
      return "CONNECTING";
    case "live":
      return "LIVE";
    case "syncing":
      return "SYNCING PAGE";
    case "clearing":
      return "CLEARING MARKS";
    case "reconnecting":
      return "RECONNECTING";
    case "full":
      return "PARTY FULL";
    case "unavailable":
      return "PARTY UNAVAILABLE";
    case "offline":
      return "PARTY OFFLINE";
    default:
      return "SOLO";
  }
}

function parsePartyHash(): string | null {
  const match = window.location.hash.match(/^#party=([^&]+)$/);
  if (!match) return null;

  try {
    const roomId = decodeURIComponent(match[1]);
    return isDrawingRoomId(roomId) ? roomId : null;
  } catch {
    return null;
  }
}

function readSessionParty(): string | null {
  try {
    const roomId = window.sessionStorage.getItem(PARTY_SESSION_KEY);
    return isDrawingRoomId(roomId) ? roomId : null;
  } catch {
    return null;
  }
}

function writeSessionParty(roomId: string | null) {
  try {
    if (roomId) {
      window.sessionStorage.setItem(PARTY_SESSION_KEY, roomId);
    } else {
      window.sessionStorage.removeItem(PARTY_SESSION_KEY);
    }
  } catch {
    // Party membership still works until this document is closed.
  }
}

function inviteUrl(roomId: string): string {
  const url = new URL(window.location.href);
  url.searchParams.delete("party");
  url.hash = `party=${encodeURIComponent(roomId)}`;
  return url.toString();
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, dialog, [role="dialog"], [role="textbox"], [contenteditable]:not([contenteditable="false"])',
    ) !== null
  );
}

function usesCoarsePrimaryPointer(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

function drawStroke(context: CanvasRenderingContext2D, stroke: StrokeRecord) {
  const { points } = stroke;
  if (points.length < 2) return;

  context.beginPath();
  context.lineCap = "round";
  context.lineJoin = "round";
  context.lineWidth = stroke.width;
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.globalAlpha = stroke.opacity;

  if (points.length === 2) {
    context.arc(points[0], points[1], stroke.width / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }

  context.moveTo(points[0], points[1]);

  if (points.length === 4) {
    context.lineTo(points[2], points[3]);
    context.stroke();
    return;
  }

  for (let index = 2; index < points.length - 2; index += 2) {
    const x = points[index];
    const y = points[index + 1];
    const nextX = points[index + 2];
    const nextY = points[index + 3];
    context.quadraticCurveTo(x, y, (x + nextX) / 2, (y + nextY) / 2);
  }

  context.lineTo(points[points.length - 2], points[points.length - 1]);
  context.stroke();
}

export function DrawingPlayground() {
  const pathname = usePathname();
  const route = normalizeRoute(pathname ?? "/");
  const publicRouteAvailable = isPublicDrawingRoute(route);
  const [enabled, setEnabled] = useState(false);
  const [color, setColor] = useState<HighlighterColor>(DEFAULT_COLOR);
  const [hydrated, setHydrated] = useState(false);
  const [clearConfirming, setClearConfirming] = useState(false);
  const [notSaving, setNotSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [partyRoomId, setPartyRoomId] = useState<string | null>(null);
  const [partyState, setPartyState] =
    useState<PartyConnectionState>("solo");
  const [partyParticipants, setPartyParticipants] = useState<
    DrawingParticipant[]
  >([]);
  const [partyIdentity, setPartyIdentity] = useState<PartyIdentity | null>(null);
  const [partyShareUrl, setPartyShareUrl] = useState("");
  const [partyError, setPartyError] = useState("");
  const [remoteCursors, setRemoteCursors] = useState<RemoteCursor[]>([]);
  const [scope, setScope] = useState<DrawingScope>("solo");
  const [menuOpen, setMenuOpen] = useState(false);
  const [nudgeVisible, setNudgeVisible] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const menuToggleRef = useRef<HTMLButtonElement>(null);
  const shareLinkRef = useRef<HTMLInputElement>(null);
  const enabledRef = useRef(false);
  const colorRef = useRef<HighlighterColor>(DEFAULT_COLOR);
  const routeRef = useRef(route);
  const currentStrokesRef = useRef<StrokeRecord[]>([]);
  const memoryStrokesRef = useRef(new Map<string, StrokeRecord[]>());
  const partyRoomIdRef = useRef<string | null>(null);
  const partyStateRef = useRef<PartyConnectionState>("solo");
  const partyIdentityRef = useRef<PartyIdentity | null>(null);
  const partySocketRef = useRef<WebSocket | null>(null);
  const partyReconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const partyReconnectAttemptsRef = useRef(0);
  const partyStrokesRef = useRef<DrawingSharedStroke[]>([]);
  const partyMemoryStrokesRef = useRef(
    new Map<string, DrawingSharedStroke[]>(),
  );
  const partyFatalRef = useRef(false);
  const partyRouteReadyRef = useRef(false);
  const partyClearPendingRouteRef = useRef<string | null>(null);
  const partySentPointIndexRef = useRef(0);
  const partyAppendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partyCursorVisibleRef = useRef(false);
  const lastPartyCursorSentRef = useRef(0);
  const activeStrokeRef = useRef<StrokeRecord | null>(null);
  const activeStrokePartyRef = useRef(false);
  const activePointerIdRef = useRef<number | null>(null);
  const activeRawPointRef = useRef<Point | null>(null);
  const activeViewportPointerRef = useRef<ViewportPointer | null>(null);
  const scrollConnectionPendingRef = useRef(false);
  const lastCheckpointRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const storageAvailableRef = useRef(true);
  const storageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mobileNavigationOpenRef = useRef(false);
  const mountedRef = useRef(false);
  const scopeRef = useRef<DrawingScope>("solo");
  const previousScopeRef = useRef<PersistedDrawingScope>("solo");
  const soloEnabledRef = useRef(false);
  const partyArmOnWelcomeRef = useRef(false);
  const initialPrivateRoomRef = useRef<string | null | undefined>(undefined);
  const initialPrivateInviteRef = useRef<boolean | undefined>(undefined);
  const privateAdmittedRef = useRef(false);
  const publicControllerRef = useRef<PublicDrawingController | null>(null);
  const routeSuppressedPublicRef = useRef(false);

  const paintCanvas = useCallback(() => {
    frameRef.current = null;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const pixelWidth = Math.round(viewportWidth * ratio);
    const pixelHeight = Math.round(viewportHeight * ratio);

    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
      canvas.style.width = `${viewportWidth}px`;
      canvas.style.height = `${viewportHeight}px`;
    }

    const context = canvas.getContext("2d");
    if (!context) return;

    context.setTransform(1, 0, 0, 1, 0, 0);
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.globalCompositeOperation = "multiply";
    context.translate(-window.scrollX, -window.scrollY);

    const viewport = {
      left: window.scrollX,
      top: window.scrollY,
      right: window.scrollX + viewportWidth,
      bottom: window.scrollY + viewportHeight,
    };

    const activeScope = scopeRef.current;
    const visibleStrokes =
      activeScope === "private"
        ? partyStrokesRef.current
        : activeScope === "solo"
          ? currentStrokesRef.current
          : [];

    for (const stroke of visibleStrokes) {
      const padding = stroke.width / 2;
      if (
        stroke.bounds.maxX + padding < viewport.left ||
        stroke.bounds.minX - padding > viewport.right ||
        stroke.bounds.maxY + padding < viewport.top ||
        stroke.bounds.minY - padding > viewport.bottom
      ) {
        continue;
      }

      drawStroke(context, stroke);
    }

    if (activeScope === "public") {
      const publicDrawing = publicControllerRef.current;
      const now = Date.now();
      const reducedMotion = window.matchMedia(
        "(prefers-reduced-motion: reduce)",
      ).matches;
      let afterglowOpacity = 1;

      if (publicDrawing?.expiresAt) {
        const remaining = publicDrawing.expiresAt - now;
        if (remaining <= 0) {
          afterglowOpacity = 0;
        } else if (
          !reducedMotion &&
          publicDrawing.fadeAt &&
          now > publicDrawing.fadeAt
        ) {
          afterglowOpacity =
            remaining /
            Math.max(1, publicDrawing.expiresAt - publicDrawing.fadeAt);
        }
      }

      for (const stroke of publicDrawing?.strokesRef.current ?? []) {
        if (
          publicDrawing?.mutedAuthors.has(stroke.authorId) ||
          afterglowOpacity <= 0
        ) {
          continue;
        }

        const bounds = anchoredBoundsToDocumentBounds(stroke);
        const points = anchoredPointsToDocumentPoints(stroke);
        if (!bounds || !points) continue;

        const padding = stroke.width / 2;
        if (
          bounds.maxX + padding < viewport.left ||
          bounds.minX - padding > viewport.right ||
          bounds.maxY + padding < viewport.top ||
          bounds.minY - padding > viewport.bottom
        ) {
          continue;
        }

        drawStroke(context, {
          version: 1,
          id: stroke.id,
          route: stroke.route,
          color: stroke.color,
          width: stroke.width,
          opacity: stroke.opacity * afterglowOpacity,
          createdAt: stroke.createdAt,
          points,
          bounds,
        });
      }
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }, []);

  const scheduleRedraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(paintCanvas);
  }, [paintCanvas]);

  const publicDrawing = usePublicDrawing({
    route,
    realtimeUrl: publicRouteAvailable ? PARTY_REALTIME_URL : "",
    color,
    width: STROKE_WIDTH,
    opacity: STROKE_OPACITY,
    onRedraw: scheduleRedraw,
    onStatus: setStatusMessage,
  });

  useEffect(() => {
    publicControllerRef.current = publicDrawing;
    scheduleRedraw();
  }, [publicDrawing, scheduleRedraw]);

  useEffect(() => {
    if (
      !publicDrawing.expiresAt ||
      !publicDrawing.fadeAt ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    let timer: number | null = null;
    let fadeStartTimer: number | null = null;
    const startFadeRedraws = () => {
      scheduleRedraw();
      timer = window.setInterval(scheduleRedraw, 250);
    };

    const delay = publicDrawing.fadeAt - Date.now();
    if (delay > 0) {
      fadeStartTimer = window.setTimeout(startFadeRedraws, delay);
    } else {
      startFadeRedraws();
    }

    return () => {
      if (fadeStartTimer !== null) window.clearTimeout(fadeStartTimer);
      if (timer !== null) window.clearInterval(timer);
    };
  }, [publicDrawing.expiresAt, publicDrawing.fadeAt, scheduleRedraw]);

  useEffect(() => {
    if (scopeRef.current !== "public") return;
    const shouldBeEnabled = publicDrawing.state === "drawing";
    if (
      publicDrawing.state !== "matching" &&
      enabledRef.current !== shouldBeEnabled
    ) {
      enabledRef.current = shouldBeEnabled;
      // Public armed state is intentionally session-only; the persisted v1
      // enabled preference belongs to the Solo layer.
      setEnabled(shouldBeEnabled);
    }
  }, [publicDrawing.state]);

  useEffect(() => {
    if (!hydrated) return;

    if (!publicRouteAvailable) {
      if (scopeRef.current !== "public") return;

      routeSuppressedPublicRef.current = true;
      scopeRef.current = "solo";
      enabledRef.current = soloEnabledRef.current;
      // Patreon routes must not join the anonymous public lobby. This is a
      // route-local override: the user's persisted Public preference remains
      // intact and is restored after navigating away.
      setScope("solo");
      setEnabled(soloEnabledRef.current);
      setMenuOpen(false);
      scheduleRedraw();
      return;
    }

    if (routeSuppressedPublicRef.current) {
      if (scopeRef.current === "private") return;

      routeSuppressedPublicRef.current = false;
      if (scopeRef.current !== "solo") return;

      scopeRef.current = "public";
      previousScopeRef.current = "public";
      enabledRef.current = false;
      setScope("public");
      setEnabled(false);
      scheduleRedraw();
      return;
    }

    if (
      !PARTY_REALTIME_URL ||
      publicDrawing.mode !== "off" ||
      scopeRef.current !== "public"
    ) {
      return;
    }

    scopeRef.current = "solo";
    previousScopeRef.current = "solo";
    writePersistedDrawingScope("solo");
    enabledRef.current = soloEnabledRef.current;
    // The server-side kill switch removes Public from the active experience
    // without deleting private local preferences or artwork.
    setScope("solo");
    setEnabled(soloEnabledRef.current);
    setMenuOpen(false);
    scheduleRedraw();
  }, [
    hydrated,
    publicDrawing.mode,
    publicRouteAvailable,
    scheduleRedraw,
    scope,
  ]);

  const markStorageUnavailable = useCallback(() => {
    storageAvailableRef.current = false;
    if (mountedRef.current) {
      setNotSaving(true);
    }
  }, []);

  const updatePartyState = useCallback((nextState: PartyConnectionState) => {
    partyStateRef.current = nextState;
    if (mountedRef.current) setPartyState(nextState);
  }, []);

  const sendPartyMessage = useCallback(
    (message: DrawingClientMessage): boolean => {
      const socket = partySocketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;

      try {
        socket.send(JSON.stringify(message));
        return true;
      } catch {
        updatePartyState("reconnecting");
        return false;
      }
    },
    [updatePartyState],
  );

  const flushPartyAppend = useCallback(
    (stroke: StrokeRecord | null = activeStrokeRef.current) => {
      if (partyAppendTimerRef.current !== null) {
        clearTimeout(partyAppendTimerRef.current);
        partyAppendTimerRef.current = null;
      }
      if (!stroke || !activeStrokePartyRef.current) return;

      const maximumCoordinates = DRAWING_ROOM_MAX_POINTS_PER_MESSAGE * 2;
      while (partySentPointIndexRef.current < stroke.points.length) {
        const startIndex = partySentPointIndexRef.current;
        const points = stroke.points.slice(
          startIndex,
          startIndex + maximumCoordinates,
        );
        if (points.length < 2) return;

        const sent = sendPartyMessage({
          type: "stroke:append",
          route: stroke.route,
          strokeId: stroke.id,
          points,
          bounds: { ...stroke.bounds },
        });
        if (!sent) return;
        partySentPointIndexRef.current = startIndex + points.length;
      }
    },
    [sendPartyMessage],
  );

  const queuePartyAppend = useCallback(() => {
    if (partyAppendTimerRef.current !== null) return;
    partyAppendTimerRef.current = setTimeout(() => {
      partyAppendTimerRef.current = null;
      flushPartyAppend();
    }, PARTY_SEND_INTERVAL_MS);
  }, [flushPartyAppend]);

  const enqueueStrokeSave = useCallback(
    (stroke: StrokeRecord) => {
      if (!storageAvailableRef.current) return;

      const snapshot = copyStroke(stroke);
      storageQueueRef.current = storageQueueRef.current
        .then(async () => {
          if (!storageAvailableRef.current) return;
          await saveStroke(snapshot);
        })
        .catch(markStorageUnavailable);
    },
    [markStorageUnavailable],
  );

  const enqueueRouteClear = useCallback(
    (routeToClear: string) => {
      if (!storageAvailableRef.current) return;

      storageQueueRef.current = storageQueueRef.current
        .then(async () => {
          if (!storageAvailableRef.current) return;
          await clearStrokes(routeToClear);
        })
        .catch(markStorageUnavailable);
    },
    [markStorageUnavailable],
  );

  const hideMarker = useCallback(() => {
    if (markerRef.current) {
      markerRef.current.dataset.visible = "false";
    }
    if (scopeRef.current === "public") {
      publicControllerRef.current?.sendCursor(
        {
          anchorSchemaVersion: 1,
          anchorId: "page-root",
          x: 0,
          y: 0,
        },
        false,
      );
    }
    if (scopeRef.current === "private" && partyCursorVisibleRef.current) {
      partyCursorVisibleRef.current = false;
      sendPartyMessage({
        type: "cursor:move",
        route: routeRef.current,
        x: 0,
        y: 0,
        color: colorRef.current,
        visible: false,
      });
    }
  }, [sendPartyMessage]);

  const finishActiveStroke = useCallback((preserveScrollConnection = false) => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }

    if (scopeRef.current === "public") {
      publicControllerRef.current?.finishStroke();
    }

    const stroke = activeStrokeRef.current;
    const rawPoint = activeRawPointRef.current;

    if (stroke && rawPoint) {
      const lastX = stroke.points[stroke.points.length - 2];
      const lastY = stroke.points[stroke.points.length - 1];
      if (Math.hypot(rawPoint.x - lastX, rawPoint.y - lastY) > 0.25) {
        stroke.points.push(rawPoint.x, rawPoint.y);
        stroke.bounds.minX = Math.min(stroke.bounds.minX, rawPoint.x);
        stroke.bounds.minY = Math.min(stroke.bounds.minY, rawPoint.y);
        stroke.bounds.maxX = Math.max(stroke.bounds.maxX, rawPoint.x);
        stroke.bounds.maxY = Math.max(stroke.bounds.maxY, rawPoint.y);
      }

      if (activeStrokePartyRef.current) {
        flushPartyAppend(stroke);
        sendPartyMessage({
          type: "stroke:end",
          route: stroke.route,
          strokeId: stroke.id,
        });
      } else {
        enqueueStrokeSave(stroke);
      }
      scheduleRedraw();
    }

    activeStrokeRef.current = null;
    activePointerIdRef.current = null;
    activeRawPointRef.current = null;
    if (!preserveScrollConnection) {
      activeViewportPointerRef.current = null;
      scrollConnectionPendingRef.current = false;
    }
    activeStrokePartyRef.current = false;
    partySentPointIndexRef.current = 0;
    lastCheckpointRef.current = 0;
  }, [enqueueStrokeSave, flushPartyAppend, scheduleRedraw, sendPartyMessage]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(
      () => finishActiveStroke(scrollConnectionPendingRef.current),
      IDLE_BREAK_MS,
    );
  }, [finishActiveStroke]);

  const addDocumentPoint = useCallback(
    (point: Point, pointerId: number) => {
      if (scopeRef.current === "public") {
        publicControllerRef.current?.addPoint(point, pointerId);
        return;
      }

      const drawingInParty = scopeRef.current === "private";
      if (
        drawingInParty &&
        (partyStateRef.current !== "live" ||
          !partyRouteReadyRef.current ||
          partyClearPendingRouteRef.current !== null)
      ) {
        return;
      }

      let stroke = activeStrokeRef.current;

      if (!stroke) {
        const now = Date.now();
        stroke = {
          version: 1,
          id: createStrokeId(),
          route: routeRef.current,
          color: colorRef.current,
          width: STROKE_WIDTH,
          opacity: STROKE_OPACITY,
          createdAt: now,
          points: [point.x, point.y],
          bounds: {
            minX: point.x,
            minY: point.y,
            maxX: point.x,
            maxY: point.y,
          },
        };
        activeStrokeRef.current = stroke;
        activeStrokePartyRef.current = drawingInParty;
        activePointerIdRef.current = pointerId;

        if (drawingInParty) {
          const identity = partyIdentityRef.current;
          if (!identity) {
            activeStrokeRef.current = null;
            activeStrokePartyRef.current = false;
            return;
          }

          const sharedStroke: DrawingSharedStroke = {
            ...stroke,
            authorId: identity.id,
            authorName: identity.name,
          };
          partyStrokesRef.current.push(sharedStroke);
          partyMemoryStrokesRef.current.set(
            routeRef.current,
            partyStrokesRef.current,
          );
          partySentPointIndexRef.current = stroke.points.length;
          sendPartyMessage({ type: "stroke:start", stroke });
        } else {
          currentStrokesRef.current.push(stroke);
          memoryStrokesRef.current.set(
            routeRef.current,
            currentStrokesRef.current,
          );
        }
        lastCheckpointRef.current = now;
      } else {
        const lastX = stroke.points[stroke.points.length - 2];
        const lastY = stroke.points[stroke.points.length - 1];
        const deltaX = point.x - lastX;
        const deltaY = point.y - lastY;
        const distance = Math.hypot(deltaX, deltaY);

        if (distance >= SAMPLE_DISTANCE) {
          const sampleCount = Math.floor(distance / SAMPLE_DISTANCE);
          const unitX = deltaX / distance;
          const unitY = deltaY / distance;

          for (let index = 1; index <= sampleCount; index += 1) {
            const x = lastX + unitX * SAMPLE_DISTANCE * index;
            const y = lastY + unitY * SAMPLE_DISTANCE * index;
            stroke.points.push(x, y);
            stroke.bounds.minX = Math.min(stroke.bounds.minX, x);
            stroke.bounds.minY = Math.min(stroke.bounds.minY, y);
            stroke.bounds.maxX = Math.max(stroke.bounds.maxX, x);
            stroke.bounds.maxY = Math.max(stroke.bounds.maxY, y);
          }
        }
      }

      activeRawPointRef.current = point;

      const now = Date.now();
      if (activeStrokePartyRef.current) {
        queuePartyAppend();
      } else if (now - lastCheckpointRef.current >= CHECKPOINT_INTERVAL_MS) {
        lastCheckpointRef.current = now;
        enqueueStrokeSave(stroke);
      }

      scheduleRedraw();
    },
    [enqueueStrokeSave, queuePartyAppend, scheduleRedraw, sendPartyMessage],
  );

  const commitPreferences = useCallback(
    (nextEnabled: boolean, nextColor: HighlighterColor) => {
      enabledRef.current = nextEnabled;
      colorRef.current = nextColor;
      setEnabled(nextEnabled);
      setColor(nextColor);
      if (scopeRef.current === "solo") {
        soloEnabledRef.current = nextEnabled;
      }
      const preferencesSaved = writePreferences({
        version: 1,
        enabled: soloEnabledRef.current,
        color: nextColor,
      } satisfies DrawingPreferences);
      if (!preferencesSaved && mountedRef.current) {
        setNotSaving(true);
      }
    },
    [],
  );

  const cancelClearConfirmation = useCallback(() => {
    if (clearTimerRef.current !== null) {
      clearTimeout(clearTimerRef.current);
      clearTimerRef.current = null;
    }
    setClearConfirming(false);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    let disposed = false;
    const preferences = readPreferences();
    discardLegacyPartyIdentity();
    soloEnabledRef.current = preferences.enabled;
    colorRef.current = preferences.color;
    // Browser preferences can only be restored after the server-rendered shell
    // hydrates. Synchronizing these two controls here is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setColor(preferences.color);
    if (!hasPreferenceStorageAccess()) {
      setNotSaving(true);
    }

    if (initialPrivateRoomRef.current === undefined) {
      const invitedRoom = parsePartyHash();
      initialPrivateInviteRef.current = invitedRoom !== null;
      initialPrivateRoomRef.current = invitedRoom ?? readSessionParty();
    }
    const initialRoom = initialPrivateRoomRef.current;

    void resolveInitialDrawingScope().then(({ scope: initialScope }) => {
      if (disposed) return;
      scopeRef.current = initialScope;
      previousScopeRef.current = initialScope;
      setScope(initialScope);
      const initialEnabled =
        initialScope === "solo" ? preferences.enabled : false;
      enabledRef.current = initialEnabled;
      setEnabled(initialEnabled);
      setNudgeVisible(
        initialScope === "public" && !isPublicNudgeDismissed(),
      );
      setHydrated(true);

      if (initialRoom) {
        // Membership is remembered again only after the server admits this
        // tab. A rejected/full/offline reconnect must not become sticky.
        if (initialPrivateInviteRef.current) writeSessionParty(null);
        const identity = readOrCreatePartyIdentity(initialRoom);
        partyRoomIdRef.current = initialRoom;
        partyIdentityRef.current = identity;
        partyRouteReadyRef.current = false;
        partyClearPendingRouteRef.current = null;
        partyArmOnWelcomeRef.current = false;
        privateAdmittedRef.current = false;
        setPartyRoomId(initialRoom);
        setPartyIdentity(identity);
        setPartyShareUrl(inviteUrl(initialRoom));
        setMenuOpen(true);
        updatePartyState(PARTY_REALTIME_URL ? "connecting" : "unavailable");
      }
    });

    return () => {
      disposed = true;
      mountedRef.current = false;
    };
  }, [updatePartyState]);

  useLayoutEffect(() => {
    if (routeRef.current === route || !partyRoomIdRef.current) return;
    // Block pointer input before the browser can dispatch events against the
    // newly rendered route. Its cached canvas is only a preview until the room
    // actor supplies the authoritative snapshot for this pathname.
    partyRouteReadyRef.current = false;
    if (
      partyStateRef.current === "live" ||
      partyStateRef.current === "clearing" ||
      partyStateRef.current === "syncing"
    ) {
      updatePartyState("syncing");
    }
  }, [route, updatePartyState]);

  useEffect(() => {
    if (!partyRoomId || !partyIdentity) return;
    const activeRoomId = partyRoomId;
    const activeIdentity = partyIdentity;
    if (!PARTY_REALTIME_URL) {
      return;
    }

    let disposed = false;

    function installSnapshot(
      snapshotRoute: string,
      strokes: DrawingSharedStroke[],
    ) {
      const snapshot = strokes.map((stroke) => ({
        ...stroke,
        points: [...stroke.points],
        bounds: { ...stroke.bounds },
      }));
      partyMemoryStrokesRef.current.set(snapshotRoute, snapshot);
      if (routeRef.current === snapshotRoute) {
        partyStrokesRef.current = snapshot;
        scheduleRedraw();
      }
    }

    function handleServerMessage(message: DrawingServerMessage) {
      if (
        disposed ||
        partyFatalRef.current ||
        partyRoomIdRef.current !== activeRoomId
      ) {
        return;
      }

      switch (message.type) {
        case "welcome":
          partyReconnectAttemptsRef.current = 0;
          privateAdmittedRef.current = true;
          // A welcome is an authoritative reconnect snapshot. It resolves a
          // clear whose acknowledgement may have been lost with the old socket.
          partyClearPendingRouteRef.current = null;
          setPartyParticipants(message.participants);
          setPartyError("");
          installSnapshot(message.route, message.strokes);
          writeSessionParty(activeRoomId);
          initialPrivateRoomRef.current = activeRoomId;
          initialPrivateInviteRef.current = false;

          if (parsePartyHash() === activeRoomId) {
            const cleanUrl = new URL(window.location.href);
            cleanUrl.hash = "";
            window.history.replaceState(
              window.history.state,
              "",
              `${cleanUrl.pathname}${cleanUrl.search}`,
            );
          }

          if (scopeRef.current !== "private") {
            const priorScope = scopeRef.current;
            previousScopeRef.current = priorScope;
            if (priorScope === "public") {
              publicControllerRef.current?.leave();
            }
            scopeRef.current = "private";
            setScope("private");
            const shouldArm = partyArmOnWelcomeRef.current;
            enabledRef.current = shouldArm;
            setEnabled(shouldArm);
            setMenuOpen(true);
            scheduleRedraw();
          }
          // Navigation can finish while the WebSocket handshake is still in
          // flight. Reassert the live pathname before any subsequent stroke
          // messages so the server and canvas cannot remain on different pages.
          if (message.route !== routeRef.current) {
            partyRouteReadyRef.current = false;
            updatePartyState("syncing");
            sendPartyMessage({ type: "route:set", route: routeRef.current });
          } else {
            partyRouteReadyRef.current = true;
            updatePartyState("live");
          }
          break;
        case "presence":
          setPartyParticipants(message.participants);
          setRemoteCursors((cursors) => {
            const participantIds = new Set(
              message.participants.map((participant) => participant.id),
            );
            return cursors.filter((cursor) => participantIds.has(cursor.authorId));
          });
          break;
        case "route:snapshot":
          installSnapshot(message.route, message.strokes);
          if (message.route === routeRef.current) {
            partyRouteReadyRef.current = true;
            updatePartyState(
              partyClearPendingRouteRef.current === null ? "live" : "clearing",
            );
            setStatusMessage(
              partyClearPendingRouteRef.current === null
                ? "Shared drawing synced for this page."
                : "Shared drawing synced. Waiting for clear confirmation.",
            );
          }
          break;
        case "stroke:start": {
          const routeStrokes =
            partyMemoryStrokesRef.current.get(message.stroke.route) ?? [];
          const existingIndex = routeStrokes.findIndex(
            (stroke) =>
              stroke.id === message.stroke.id &&
              stroke.authorId === message.stroke.authorId,
          );
          if (existingIndex < 0) {
            routeStrokes.push({
              ...message.stroke,
              points: [...message.stroke.points],
              bounds: { ...message.stroke.bounds },
            });
          }
          partyMemoryStrokesRef.current.set(message.stroke.route, routeStrokes);
          if (routeRef.current === message.stroke.route) {
            partyStrokesRef.current = routeStrokes;
            scheduleRedraw();
          }
          break;
        }
        case "stroke:append": {
          const routeStrokes =
            partyMemoryStrokesRef.current.get(message.route) ?? [];
          const stroke = routeStrokes.find(
            (candidate) =>
              candidate.id === message.strokeId &&
              candidate.authorId === message.authorId,
          );
          if (stroke) {
            stroke.points.push(...message.points);
            stroke.bounds = { ...message.bounds };
            if (routeRef.current === message.route) scheduleRedraw();
          }
          break;
        }
        case "strokes:cleared": {
          const routeStrokes = (
            partyMemoryStrokesRef.current.get(message.route) ?? []
          ).filter((stroke) => stroke.authorId !== message.authorId);
          partyMemoryStrokesRef.current.set(message.route, routeStrokes);
          if (routeRef.current === message.route) {
            partyStrokesRef.current = routeStrokes;
            scheduleRedraw();
          }
          if (
            message.authorId === activeIdentity.id &&
            partyClearPendingRouteRef.current === message.route
          ) {
            partyClearPendingRouteRef.current = null;
            updatePartyState(
              partyRouteReadyRef.current ? "live" : "syncing",
            );
            setStatusMessage("Your shared marks were cleared from this page.");
          }
          break;
        }
        case "room:reset":
          partyMemoryStrokesRef.current.clear();
          partyStrokesRef.current = [];
          scheduleRedraw();
          break;
        case "cursor:move":
          if (message.authorId === partyIdentityRef.current?.id) break;
          setRemoteCursors((cursors) => {
            const remaining = cursors.filter(
              (cursor) => cursor.authorId !== message.authorId,
            );
            return message.visible
              ? [...remaining, { ...message }]
              : remaining;
          });
          break;
        case "error":
          setPartyError(message.message);
          if (message.fatal) {
            partyFatalRef.current = true;
            partyRouteReadyRef.current = false;
            partyClearPendingRouteRef.current = null;
            updatePartyState(message.code === "ROOM_FULL" ? "full" : "offline");
          }
          break;
        case "stroke:end":
        case "pong":
          break;
      }
    }

    function connect() {
      if (disposed || partyFatalRef.current) return;
      const existingSocket = partySocketRef.current;
      if (
        existingSocket?.readyState === WebSocket.OPEN ||
        existingSocket?.readyState === WebSocket.CONNECTING
      ) {
        return;
      }
      if (!navigator.onLine) {
        partyRouteReadyRef.current = false;
        updatePartyState("offline");
        return;
      }

      partyRouteReadyRef.current = false;
      updatePartyState(
        partyReconnectAttemptsRef.current > 0 ? "reconnecting" : "connecting",
      );

      let socket: WebSocket;
      try {
        socket = new WebSocket(
          drawingRoomWebSocketUrl(
            PARTY_REALTIME_URL,
            activeRoomId,
            activeIdentity.id,
            activeIdentity.name,
            routeRef.current,
          ),
          drawingRoomWebSocketProtocols(activeIdentity.token),
        );
      } catch {
        updatePartyState("unavailable");
        setPartyError("The realtime drawing address is invalid.");
        return;
      }

      partySocketRef.current = socket;
      socket.addEventListener("message", (event) => {
        if (disposed || partySocketRef.current !== socket) return;
        if (typeof event.data !== "string") return;
        const message = parseDrawingServerMessageJson(event.data);
        if (message) handleServerMessage(message);
      });
      socket.addEventListener("error", () => {
        if (
          !disposed &&
          partySocketRef.current === socket &&
          !partyFatalRef.current
        ) {
          setPartyError("Connection interrupted.");
        }
      });
      socket.addEventListener("close", () => {
        if (
          disposed ||
          partyFatalRef.current ||
          partySocketRef.current !== socket
        ) {
          return;
        }

        partySocketRef.current = null;
        partyRouteReadyRef.current = false;
        setRemoteCursors([]);
        partyReconnectAttemptsRef.current += 1;
        updatePartyState(
          partyReconnectAttemptsRef.current > 4 ? "offline" : "reconnecting",
        );
        const delay = Math.min(
          8_000,
          500 * 2 ** (partyReconnectAttemptsRef.current - 1),
        );
        partyReconnectTimerRef.current = setTimeout(connect, delay);
      });
    }

    partyFatalRef.current = false;
    partyReconnectAttemptsRef.current = 0;
    connect();

    function handleOnline() {
      if (
        disposed ||
        partyFatalRef.current ||
        partyRoomIdRef.current !== activeRoomId
      ) {
        return;
      }
      if (partyReconnectTimerRef.current !== null) {
        clearTimeout(partyReconnectTimerRef.current);
        partyReconnectTimerRef.current = null;
      }
      connect();
    }

    function handleOffline() {
      if (
        disposed ||
        partyFatalRef.current ||
        partyRoomIdRef.current !== activeRoomId
      ) {
        return;
      }
      partyRouteReadyRef.current = false;
      updatePartyState("offline");
    }

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      disposed = true;
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      if (partyReconnectTimerRef.current !== null) {
        clearTimeout(partyReconnectTimerRef.current);
        partyReconnectTimerRef.current = null;
      }
      const socket = partySocketRef.current;
      partySocketRef.current = null;
      socket?.close(1000, "Leaving party");
    };
  }, [
    partyIdentity,
    partyRoomId,
    scheduleRedraw,
    sendPartyMessage,
    updatePartyState,
  ]);

  useEffect(() => {
    const loadGeneration = loadGenerationRef.current + 1;
    loadGenerationRef.current = loadGeneration;

    if (routeRef.current !== route) {
      cancelClearConfirmation();
      finishActiveStroke();
      hideMarker();
      routeRef.current = route;
    }

    const cachedStrokes = memoryStrokesRef.current.get(route);
    currentStrokesRef.current = cachedStrokes ?? [];

    if (partyRoomIdRef.current) {
      partyStrokesRef.current = partyMemoryStrokesRef.current.get(route) ?? [];
      sendPartyMessage({ type: "route:set", route });
      setPartyShareUrl(inviteUrl(partyRoomIdRef.current));
      setRemoteCursors((cursors) =>
        cursors.filter((cursor) => cursor.route === route && cursor.visible),
      );
    }
    scheduleRedraw();

    if (cachedStrokes || !storageAvailableRef.current) return;

    void loadStrokes(route)
      .then((storedStrokes) => {
        if (
          loadGenerationRef.current !== loadGeneration ||
          routeRef.current !== route
        ) {
          return;
        }

        const sessionStrokes = memoryStrokesRef.current.get(route) ?? [];
        const sessionIds = new Set(sessionStrokes.map((stroke) => stroke.id));
        const mergedStrokes = [
          ...storedStrokes.filter((stroke) => !sessionIds.has(stroke.id)),
          ...sessionStrokes,
        ].sort(
          (left, right) =>
            left.createdAt - right.createdAt || left.id.localeCompare(right.id),
        );

        memoryStrokesRef.current.set(route, mergedStrokes);
        currentStrokesRef.current = mergedStrokes;
        scheduleRedraw();
      })
      .catch(markStorageUnavailable);
  }, [
    cancelClearConfirmation,
    finishActiveStroke,
    hideMarker,
    markStorageUnavailable,
    route,
    scheduleRedraw,
    sendPartyMessage,
  ]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType === "touch") {
        finishActiveStroke();
        hideMarker();
        return;
      }

      const target = event.target;
      const isOverControls =
        target instanceof Element &&
        target.closest("[data-drawing-control]") !== null;
      const activeScope = scopeRef.current;
      const realtimeNotReady =
        (activeScope === "private" &&
          (partyStateRef.current !== "live" ||
            !partyRouteReadyRef.current ||
            partyClearPendingRouteRef.current !== null)) ||
        (activeScope === "public" &&
          !publicControllerRef.current?.drawingReady);

      if (
        activeScope === "public" &&
        event.pointerType === "pen" &&
        !enabledRef.current &&
        !isOverControls &&
        !mobileNavigationOpenRef.current &&
        (publicControllerRef.current?.state === "watching" ||
          publicControllerRef.current?.state === "paused")
      ) {
        enabledRef.current = true;
        setEnabled(true);
        publicControllerRef.current?.requestDrawing();
        setStatusMessage("Joining a public drawing seat for your stylus.");
        hideMarker();
        return;
      }

      if (
        !enabledRef.current ||
        realtimeNotReady ||
        isOverControls ||
        mobileNavigationOpenRef.current
      ) {
        activeViewportPointerRef.current = null;
        scrollConnectionPendingRef.current = false;
        hideMarker();
        if (isOverControls || mobileNavigationOpenRef.current) {
          finishActiveStroke();
        }
        return;
      }

      if (
        activePointerIdRef.current !== null &&
        activePointerIdRef.current !== event.pointerId
      ) {
        finishActiveStroke();
      }

      if (event.pointerType === "pen" && event.cancelable) {
        event.preventDefault();
      }

      const coalescedEvents = event.getCoalescedEvents?.() ?? [];
      const pointerEvents =
        coalescedEvents.length > 0 ? coalescedEvents : [event];

      const priorPointer = activeViewportPointerRef.current;
      if (
        scrollConnectionPendingRef.current &&
        idleTimerRef.current === null &&
        priorPointer
      ) {
        addDocumentPoint(
          { x: priorPointer.documentX, y: priorPointer.documentY },
          event.pointerId,
        );
      }

      for (const pointerEvent of pointerEvents) {
        addDocumentPoint(
          {
            x: pointerEvent.clientX + window.scrollX,
            y: pointerEvent.clientY + window.scrollY,
          },
          event.pointerId,
        );
      }

      activeViewportPointerRef.current = {
        x: event.clientX,
        y: event.clientY,
        documentX: event.clientX + window.scrollX,
        documentY: event.clientY + window.scrollY,
        pointerId: event.pointerId,
      };
      scrollConnectionPendingRef.current = false;

      resetIdleTimer();

      const marker = markerRef.current;
      if (marker) {
        marker.style.transform = `translate3d(${event.clientX - STROKE_WIDTH / 2}px, ${event.clientY - STROKE_WIDTH / 2}px, 0)`;
        marker.dataset.visible = "true";
      }

      const now = performance.now();
      if (
        activeScope === "private" &&
        partyStateRef.current === "live" &&
        now - lastPartyCursorSentRef.current >= PARTY_SEND_INTERVAL_MS
      ) {
        lastPartyCursorSentRef.current = now;
        partyCursorVisibleRef.current = true;
        sendPartyMessage({
          type: "cursor:move",
          route: routeRef.current,
          x: event.clientX + window.scrollX,
          y: event.clientY + window.scrollY,
          color: colorRef.current,
          visible: true,
        });
      } else if (activeScope === "public") {
        const anchored = documentPointToAnchoredPoint(
          event.clientX + window.scrollX,
          event.clientY + window.scrollY,
        );
        if (anchored) {
          publicControllerRef.current?.sendCursor(anchored, true);
        }
      }
    }

    function handlePointerCancel(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      hideMarker();
      finishActiveStroke();
    }

    function handleWindowExit(event: PointerEvent) {
      if (event.relatedTarget !== null) return;
      hideMarker();
      finishActiveStroke();
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        hideMarker();
        finishActiveStroke();
        if (scopeRef.current === "public") {
          enabledRef.current = false;
          setEnabled(false);
        }
        publicControllerRef.current?.releaseForBackground();
      }
    }

    function handlePageHide() {
      hideMarker();
      finishActiveStroke();
      publicControllerRef.current?.releaseForBackground();
    }

    function handleScroll() {
      const pointer = activeViewportPointerRef.current;
      if (pointer) {
        // A stationary pointer still moves across document coordinates while
        // the viewport scrolls. Recording that point keeps the line continuous
        // and lets the normal idle boundary persist it after scrolling stops.
        const nextPoint = {
          x: pointer.x + window.scrollX,
          y: pointer.y + window.scrollY,
        };

        if (idleTimerRef.current === null) {
          addDocumentPoint(
            { x: pointer.documentX, y: pointer.documentY },
            pointer.pointerId,
          );
        }

        if (scopeRef.current === "public") {
          // Public marks are anchored to page regions. Sampling the scroll path
          // here keeps adjacent anchored strokes touching when the stationary
          // pointer crosses from one region into another.
          const deltaX = nextPoint.x - pointer.documentX;
          const deltaY = nextPoint.y - pointer.documentY;
          const distance = Math.hypot(deltaX, deltaY);
          const sampleCount = Math.floor(
            distance / PUBLIC_SCROLL_SAMPLE_DISTANCE,
          );

          if (sampleCount > 0) {
            const unitX = deltaX / distance;
            const unitY = deltaY / distance;
            for (let index = 1; index <= sampleCount; index += 1) {
              addDocumentPoint(
                {
                  x:
                    pointer.documentX +
                    unitX * PUBLIC_SCROLL_SAMPLE_DISTANCE * index,
                  y:
                    pointer.documentY +
                    unitY * PUBLIC_SCROLL_SAMPLE_DISTANCE * index,
                },
                pointer.pointerId,
              );
            }
            pointer.documentX +=
              unitX * PUBLIC_SCROLL_SAMPLE_DISTANCE * sampleCount;
            pointer.documentY +=
              unitY * PUBLIC_SCROLL_SAMPLE_DISTANCE * sampleCount;
          }
        } else {
          addDocumentPoint(nextPoint, pointer.pointerId);
          pointer.documentX = nextPoint.x;
          pointer.documentY = nextPoint.y;
        }
        scrollConnectionPendingRef.current = true;
        resetIdleTimer();
      }
      handleViewportChange();
    }

    function handleViewportChange() {
      scheduleRedraw();
      if (scopeRef.current === "private") {
        setRemoteCursors((cursors) => [...cursors]);
      }
    }

    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
    });
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("pointerout", handleWindowExit, true);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("resize", handleViewportChange, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("pointerout", handleWindowExit, true);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("resize", handleViewportChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      finishActiveStroke();
    };
  }, [
    addDocumentPoint,
    finishActiveStroke,
    hideMarker,
    resetIdleTimer,
    scheduleRedraw,
    sendPartyMessage,
  ]);

  useEffect(() => {
    const toolbar = toolbarRef.current;
    const root = rootRef.current;
    if (!toolbar || !root) return;

    function synchronizeMobileNavigation() {
      const menuOpen =
        document.querySelector('.site-header[data-menu-open="true"]') !== null;
      mobileNavigationOpenRef.current = menuOpen;
      toolbarRef.current!.inert = menuOpen;
      rootRef.current!.dataset.navigationOpen = String(menuOpen);

      if (menuOpen) {
        hideMarker();
        finishActiveStroke();
      }
    }

    synchronizeMobileNavigation();
    const observer = new MutationObserver(synchronizeMobileNavigation);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["data-menu-open"],
      subtree: true,
    });

    return () => observer.disconnect();
  }, [finishActiveStroke, hideMarker]);

  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const anchors = document.querySelectorAll<HTMLElement>(
      "[data-drawing-anchor]",
    );
    const observer = new ResizeObserver(scheduleRedraw);
    anchors.forEach((anchor) => observer.observe(anchor));
    return () => observer.disconnect();
  }, [route, scheduleRedraw]);

  useEffect(() => {
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
      }
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  const handleToggle = useCallback((forceDrawer = false) => {
    cancelClearConfirmation();

    if (
      scopeRef.current === "public" &&
      publicControllerRef.current?.mode === "off" &&
      PARTY_REALTIME_URL
    ) {
      scopeRef.current = "solo";
      previousScopeRef.current = "solo";
      writePersistedDrawingScope("solo");
      enabledRef.current = soloEnabledRef.current;
      setScope("solo");
      setEnabled(soloEnabledRef.current);
    }

    if (scopeRef.current === "public") {
      finishActiveStroke();
      if (publicControllerRef.current?.mode === "off") {
        enabledRef.current = false;
        setEnabled(false);
        setStatusMessage(
          "Live drawing is offline. Open drawing options to draw Solo.",
        );
        return;
      }
      if (
        enabledRef.current ||
        publicControllerRef.current?.state === "drawing" ||
        publicControllerRef.current?.state === "matching"
      ) {
        enabledRef.current = false;
        setEnabled(false);
        publicControllerRef.current?.pause();
        hideMarker();
        setMenuOpen(false);
        setStatusMessage("Public drawing paused.");
        return;
      }

      setNudgeVisible(false);
      dismissPublicNudge();
      if (usesCoarsePrimaryPointer() && !forceDrawer) {
        enabledRef.current = false;
        setEnabled(false);
        publicControllerRef.current?.requestWatching();
        setStatusMessage(
          "Watching public drawing. Touch gestures still scroll and tap normally.",
        );
      } else {
        enabledRef.current = true;
        setEnabled(true);
        publicControllerRef.current?.requestDrawing();
        setStatusMessage("Joining a public drawing pod.");
      }
      return;
    }

    const nextEnabled = !enabledRef.current;
    finishActiveStroke();
    if (!nextEnabled) {
      hideMarker();
      setMenuOpen(false);
    }
    if (scopeRef.current === "private") {
      enabledRef.current = nextEnabled;
      setEnabled(nextEnabled);
    } else {
      commitPreferences(nextEnabled, colorRef.current);
    }
    setStatusMessage(nextEnabled ? "Drawing mode on." : "Drawing mode off.");
  }, [
    cancelClearConfirmation,
    commitPreferences,
    finishActiveStroke,
    hideMarker,
  ]);

  useEffect(() => {
    function handleDrawingShortcut(event: KeyboardEvent) {
      if (
        !event.defaultPrevented &&
        !event.isComposing &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        event.key === "Escape" &&
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        ) === null &&
        !mobileNavigationOpenRef.current
      ) {
        finishActiveStroke();
        hideMarker();
        if (scopeRef.current === "public") {
          publicControllerRef.current?.pause();
        } else if (scopeRef.current === "private") {
          enabledRef.current = false;
          setEnabled(false);
        } else if (enabledRef.current) {
          commitPreferences(false, colorRef.current);
        }
        enabledRef.current = false;
        setEnabled(false);
        setMenuOpen(false);
        cancelClearConfirmation();
        setStatusMessage("Drawing paused and options closed.");
        return;
      }

      if (
        event.defaultPrevented ||
        event.repeat ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.key.toLowerCase() !== "p" ||
        isTextEntryTarget(event.target) ||
        document.querySelector(
          'dialog[open], [role="dialog"][aria-modal="true"]',
        ) !== null ||
        mobileNavigationOpenRef.current
      ) {
        return;
      }

      event.preventDefault();
      const wasPublicAmbient =
        scopeRef.current === "public" &&
        !enabledRef.current &&
        publicControllerRef.current?.state === "ambient";
      handleToggle(true);
      if (wasPublicAmbient) setMenuOpen(false);
    }

    window.addEventListener("keydown", handleDrawingShortcut);
    return () => window.removeEventListener("keydown", handleDrawingShortcut);
  }, [
    cancelClearConfirmation,
    commitPreferences,
    finishActiveStroke,
    handleToggle,
    hideMarker,
  ]);

  function handleColorChange(nextColor: HighlighterColor, label: string) {
    cancelClearConfirmation();
    if (nextColor === colorRef.current) return;
    finishActiveStroke();
    commitPreferences(enabledRef.current, nextColor);
    setStatusMessage(`${label} selected.`);
  }

  function handleColorKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (currentIndex + 1) % PALETTE.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (currentIndex - 1 + PALETTE.length) % PALETTE.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = PALETTE.length - 1;
    }

    if (nextIndex === null) return;

    event.preventDefault();
    const choice = PALETTE[nextIndex];
    handleColorChange(choice.value, choice.label);
    toolbarRef.current
      ?.querySelector<HTMLButtonElement>(
        `[data-color-id="${choice.id}"]`,
      )
      ?.focus();
  }

  function handleClear() {
    if (!clearConfirming) {
      setClearConfirming(true);
      setStatusMessage(
        "Press Clear again within five seconds to erase this page's drawing.",
      );
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setClearConfirming(false);
        setStatusMessage("Clear confirmation expired.");
      }, CLEAR_CONFIRMATION_MS);
      return;
    }

    cancelClearConfirmation();
    finishActiveStroke();
    loadGenerationRef.current += 1;
    currentStrokesRef.current = [];
    memoryStrokesRef.current.set(routeRef.current, []);
    enqueueRouteClear(routeRef.current);
    commitPreferences(false, colorRef.current);
    hideMarker();
    scheduleRedraw();
    setStatusMessage("Drawing cleared. Drawing mode off.");
  }

  function handleStartParty() {
    cancelClearConfirmation();
    if (!PARTY_REALTIME_URL) {
      updatePartyState("unavailable");
      setPartyError("Realtime drawing has not been configured for this site.");
      setStatusMessage("Party drawing is unavailable.");
      return;
    }

    finishActiveStroke();
    if (scopeRef.current !== "private") {
      previousScopeRef.current = scopeRef.current;
    }
    partyArmOnWelcomeRef.current = enabledRef.current;
    const roomId = createDrawingRoomId();
    initialPrivateRoomRef.current = roomId;
    initialPrivateInviteRef.current = false;
    privateAdmittedRef.current = false;
    const identity = readOrCreatePartyIdentity(roomId);
    partyRoomIdRef.current = roomId;
    partyIdentityRef.current = identity;
    partyRouteReadyRef.current = false;
    partyClearPendingRouteRef.current = null;
    partyStrokesRef.current = [];
    partyMemoryStrokesRef.current.clear();
    setPartyRoomId(roomId);
    setPartyIdentity(identity);
    setPartyParticipants([]);
    setPartyError("");
    setPartyShareUrl(inviteUrl(roomId));
    updatePartyState("connecting");
    scheduleRedraw();
    setStatusMessage("Party created. Connecting now.");
  }

  async function handleCopyInvite() {
    if (!partyRoomIdRef.current) return;
    const url = inviteUrl(partyRoomIdRef.current);
    setPartyShareUrl(url);

    try {
      await navigator.clipboard.writeText(url);
      setStatusMessage("Invite link copied.");
    } catch {
      shareLinkRef.current?.focus();
      shareLinkRef.current?.select();
      setStatusMessage("Invite link selected. Copy it to share this party.");
    }
  }

  function handleClearMine() {
    if (partyStateRef.current !== "live") return;
    if (!clearConfirming) {
      setClearConfirming(true);
      setStatusMessage(
        "Press Clear My Marks again within five seconds to erase your shared marks on this page.",
      );
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setClearConfirming(false);
        setStatusMessage("Clear confirmation expired.");
      }, CLEAR_CONFIRMATION_MS);
      return;
    }

    cancelClearConfirmation();
    finishActiveStroke();
    if (sendPartyMessage({ type: "clear:mine", route: routeRef.current })) {
      partyClearPendingRouteRef.current = routeRef.current;
      updatePartyState("clearing");
      hideMarker();
      setStatusMessage(
        "Clearing your shared marks. Drawing will resume after the party confirms it.",
      );
    } else {
      setStatusMessage("Could not clear marks while the party is offline.");
    }
  }

  function handlePublicClearMine() {
    if (!clearConfirming) {
      setClearConfirming(true);
      setStatusMessage(
        "Press Clear My Marks again within five seconds to erase your public marks.",
      );
      clearTimerRef.current = setTimeout(() => {
        clearTimerRef.current = null;
        setClearConfirming(false);
        setStatusMessage("Clear confirmation expired.");
      }, CLEAR_CONFIRMATION_MS);
      return;
    }

    cancelClearConfirmation();
    finishActiveStroke();
    if (publicDrawing.clearMine()) {
      hideMarker();
      setStatusMessage("Clearing your public marks.");
    } else {
      setStatusMessage("Could not clear marks while Live is offline.");
    }
  }

  function selectPersistedScope(nextScope: PersistedDrawingScope) {
    if (scopeRef.current === nextScope && partyRoomIdRef.current === null) return;
    cancelClearConfirmation();
    finishActiveStroke();
    hideMarker();

    if (scopeRef.current === "private") {
      handleLeaveParty(nextScope);
      return;
    }

    if (scopeRef.current === "public") {
      publicDrawing.leave();
    }

    scopeRef.current = nextScope;
    previousScopeRef.current = nextScope;
    setScope(nextScope);
    writePersistedDrawingScope(nextScope);
    const nextEnabled = nextScope === "solo" ? soloEnabledRef.current : false;
    enabledRef.current = nextEnabled;
    setEnabled(nextEnabled);
    scheduleRedraw();
    setStatusMessage(
      nextScope === "solo"
        ? "Solo drawing selected. Marks stay in this browser."
        : "Public drawing selected. Press P or the balloon to join.",
    );
  }

  function handleLeaveParty(restoredScope = previousScopeRef.current) {
    const wasAdmitted = privateAdmittedRef.current;
    const enabledBeforeLeave = enabledRef.current;
    cancelClearConfirmation();
    finishActiveStroke();
    hideMarker();
    partyFatalRef.current = true;
    partyRouteReadyRef.current = false;
    partyClearPendingRouteRef.current = null;
    if (partyReconnectTimerRef.current !== null) {
      clearTimeout(partyReconnectTimerRef.current);
      partyReconnectTimerRef.current = null;
    }
    const partySocket = partySocketRef.current;
    partySocketRef.current = null;
    partySocket?.close(1000, "Leaving party");
    partyRoomIdRef.current = null;
    partyIdentityRef.current = null;
    initialPrivateRoomRef.current = null;
    initialPrivateInviteRef.current = false;
    privateAdmittedRef.current = false;
    setPartyRoomId(null);
    setPartyIdentity(null);
    setPartyParticipants([]);
    setPartyError("");
    setPartyShareUrl("");
    setRemoteCursors([]);
    writeSessionParty(null);
    const invitedRoom = parsePartyHash();
    if (invitedRoom) {
      const cleanUrl = new URL(window.location.href);
      cleanUrl.hash = "";
      window.history.replaceState(
        window.history.state,
        "",
        `${cleanUrl.pathname}${cleanUrl.search}`,
      );
    }
    updatePartyState("solo");
    scopeRef.current = restoredScope;
    previousScopeRef.current = restoredScope;
    setScope(restoredScope);
    writePersistedDrawingScope(restoredScope);
    const restoredEnabled = wasAdmitted ? false : enabledBeforeLeave;
    if (wasAdmitted && restoredScope === "solo") {
      soloEnabledRef.current = false;
      const saved = writePreferences({
        version: 1,
        enabled: false,
        color: colorRef.current,
      } satisfies DrawingPreferences);
      if (!saved) setNotSaving(true);
    }
    enabledRef.current = restoredEnabled;
    setEnabled(restoredEnabled);
    scheduleRedraw();
    setStatusMessage("You left the drawing party.");
  }

  const rootStyle = {
    "--drawing-color": color,
  } as CSSProperties;
  const toolsVisible = menuOpen;
  const publicFeatureAvailable =
    publicRouteAvailable &&
    (publicDrawing.mode !== "off" || PARTY_REALTIME_URL.length === 0);
  const shownSessionCount = Math.min(99, publicDrawing.sessionCount);
  const publicStatusLabel =
    publicDrawing.state === "drawing"
      ? "LIVE · DRAWING"
      : publicDrawing.state === "matching"
        ? "MATCHING"
        : publicDrawing.state === "paused"
          ? "LIVE · PAUSED"
          : publicDrawing.state === "watching"
            ? "LIVE · WATCHING"
            : publicDrawing.state === "busy"
              ? "LIVE BUSY"
              : publicDrawing.state === "offline"
                ? "LIVE OFFLINE"
                : `${publicDrawing.sessionCount} HERE`;

  return (
    <div
      className="drawing-playground"
      data-enabled={enabled}
      data-home={route === "/"}
      data-hydrated={hydrated}
      data-menu-open={menuOpen}
      data-party-id={partyRoomId ?? undefined}
      data-party-state={partyState}
      data-public-mode={publicDrawing.mode}
      data-public-state={publicDrawing.state}
      data-saving={notSaving ? "memory-only" : "persistent"}
      data-scope={scope}
      data-testid="drawing-playground"
      ref={rootRef}
      style={rootStyle}
    >
      <canvas
        aria-hidden="true"
        className="drawing-canvas"
        data-visible-scope={scope}
        data-testid="drawing-canvas"
        key={route}
        ref={canvasRef}
      />

      <span
        aria-hidden="true"
        className="drawing-marker"
        data-visible="false"
        ref={markerRef}
      />

      {scope === "private" && remoteCursors
        .filter((cursor) => cursor.visible && cursor.route === route)
        .map((cursor) => (
          <span
            aria-hidden="true"
            className="drawing-remote-cursor"
            data-testid="party-remote-cursor"
            key={cursor.authorId}
            style={
              {
                "--remote-cursor-color": cursor.color,
                transform: `translate3d(${cursor.x - window.scrollX - STROKE_WIDTH / 2}px, ${cursor.y - window.scrollY - STROKE_WIDTH / 2}px, 0)`,
              } as CSSProperties
            }
          >
            <span>{cursor.authorName}</span>
          </span>
        ))}

      {scope === "public" &&
        publicDrawing.cursors
          .filter(
            (cursor) =>
              cursor.visible && !publicDrawing.mutedAuthors.has(cursor.authorId),
          )
          .map((cursor) => {
            if (cursor.anchorSchemaVersion !== 1) return null;
            const point = anchoredPointToDocumentPoint({
              anchorSchemaVersion: 1,
              anchorId: cursor.anchorId,
              x: cursor.x,
              y: cursor.y,
            });
            if (!point) return null;
            return (
              <span
                aria-hidden="true"
                className="drawing-remote-cursor"
                data-testid="public-remote-cursor"
                key={cursor.authorId}
                style={
                  {
                    "--remote-cursor-color": cursor.color,
                    transform: `translate3d(${point.x - window.scrollX - STROKE_WIDTH / 2}px, ${point.y - window.scrollY - STROKE_WIDTH / 2}px, 0)`,
                  } as CSSProperties
                }
              >
                <span style={{ "--cursor-label-ms": `${PUBLIC_CURSOR_LABEL_MS}ms` } as CSSProperties}>
                  {cursor.authorName}
                </span>
              </span>
            );
          })}

      {route !== "/" &&
      nudgeVisible &&
      scope === "public" &&
      publicDrawing.mode !== "off" ? (
        <aside className="drawing-public-nudge" data-testid="public-nudge">
          <span>
            {shownSessionCount}
            {publicDrawing.sessionCount > 99 ? "+" : ""} HERE ·{" "}
            {usesCoarsePrimaryPointer() ? "TAP TO WATCH" : "PRESS P TO DRAW"}
          </span>
          <button
            aria-label="Dismiss live drawing tip"
            data-drawing-control
            data-testid="public-nudge-dismiss"
            onClick={() => {
              dismissPublicNudge();
              setNudgeVisible(false);
            }}
            type="button"
          >
            ×
          </button>
        </aside>
      ) : null}

      <div
        className="drawing-toolbar"
        data-drawing-control
        data-testid="drawing-toolbar"
        onPointerEnter={() => {
          hideMarker();
          finishActiveStroke();
        }}
        ref={toolbarRef}
      >
        <div
          className="drawing-tool-stack"
          data-testid="drawing-companion-menu"
          data-visible={toolsVisible}
          id="drawing-tools"
          inert={!toolsVisible ? true : undefined}
          aria-label="Drawing options"
          role="group"
        >
          <button
            aria-label="Close drawing options"
            className="drawing-menu-close"
            data-testid="drawing-menu-close"
            onClick={() => {
              finishActiveStroke();
              hideMarker();
              setMenuOpen(false);
              menuToggleRef.current?.focus();
            }}
            type="button"
          >
            <span aria-hidden="true">×</span>
          </button>

          <div
            aria-label="Highlighter color"
            className="drawing-colors"
            role="radiogroup"
          >
            {PALETTE.map((choice, index) => (
              <button
                aria-checked={color === choice.value}
                aria-label={choice.label}
                className="drawing-color"
                data-color-id={choice.id}
                data-selected={color === choice.value}
                data-testid={`drawing-color-${choice.id}`}
                key={choice.id}
                onClick={() => handleColorChange(choice.value, choice.label)}
                onKeyDown={(event) => handleColorKeyDown(event, index)}
                role="radio"
                style={{ "--swatch-color": choice.value } as CSSProperties}
                title={choice.label}
                tabIndex={color === choice.value ? 0 : -1}
                type="button"
              >
                <span aria-hidden="true" className="drawing-color-swatch" />
              </button>
            ))}
          </div>

          {partyRoomId === null ? (
            <>
              <section
                aria-label="Drawing scope"
                className="drawing-scope-panel"
              >
                <span className="drawing-menu-label">DRAW WITH</span>
                <div
                  className="drawing-scope-options"
                  data-public-available={publicFeatureAvailable}
                >
                  {publicFeatureAvailable ? (
                    <button
                      aria-pressed={scope === "public"}
                      className="drawing-scope-button"
                      data-testid="drawing-scope-public"
                      onClick={() => selectPersistedScope("public")}
                      type="button"
                    >
                      PUBLIC
                    </button>
                  ) : null}
                  <button
                    aria-pressed={scope === "solo"}
                    className="drawing-scope-button"
                    data-testid="drawing-scope-solo"
                    onClick={() => selectPersistedScope("solo")}
                    type="button"
                  >
                    SOLO
                  </button>
                </div>
              </section>

              {scope === "public" && publicFeatureAvailable ? (
                <section
                  aria-label="Public drawing"
                  className="drawing-public-panel"
                >
                  <div className="drawing-party-heading">
                    <strong data-testid="public-live-status">
                      {publicStatusLabel}
                    </strong>
                    <span>
                      {
                        publicDrawing.participants.filter(
                          (participant) => participant.drawing,
                        ).length
                      }
                      /4 DRAWING
                    </span>
                  </div>

                  {publicDrawing.identity ? (
                    <p className="drawing-party-identity">
                      YOU: {publicDrawing.identity.name}
                    </p>
                  ) : null}

                  {publicDrawing.participants.length > 0 ? (
                    <ul
                      aria-label="Public pod participants"
                      className="drawing-public-participants"
                      data-testid="public-participant-list"
                    >
                      {publicDrawing.participants.map((participant) => {
                        const isSelf =
                          participant.id === publicDrawing.identity?.id;
                        const muted = publicDrawing.mutedAuthors.has(
                          participant.id,
                        );
                        return (
                          <li
                            data-testid={`public-drawer-${participant.id}`}
                            key={participant.id}
                          >
                            <span>
                              {participant.name}
                              {isSelf ? " · YOU" : ""}
                            </span>
                            {!isSelf ? (
                              <button
                                aria-pressed={muted}
                                data-testid={`public-mute-${participant.id}`}
                                onClick={() =>
                                  publicDrawing.toggleMute(participant.id)
                                }
                                type="button"
                              >
                                {muted ? "UNMUTE" : "MUTE"}
                              </button>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  ) : null}

                  {publicDrawing.error ? (
                    <p className="drawing-public-error" role="alert">
                      {publicDrawing.error}
                    </p>
                  ) : null}

                  {publicDrawing.state === "offline" ||
                  publicDrawing.state === "busy" ? (
                    <div className="drawing-public-actions">
                      <button
                        className="drawing-party-button"
                        data-testid="public-retry"
                        onClick={publicDrawing.retry}
                        type="button"
                      >
                        RETRY LIVE
                      </button>
                      <button
                        className="drawing-party-button"
                        data-testid="public-draw-solo"
                        onClick={() => selectPersistedScope("solo")}
                        type="button"
                      >
                        DRAW SOLO
                      </button>
                    </div>
                  ) : (
                    <>
                      {publicDrawing.state !== "ambient" ? (
                        <button
                          aria-label={
                            clearConfirming
                              ? "Confirm clear your public marks"
                              : "Clear your public marks"
                          }
                          className="drawing-party-button"
                          data-confirming={clearConfirming || undefined}
                          data-testid="public-clear-mine"
                          onClick={handlePublicClearMine}
                          type="button"
                        >
                          {clearConfirming ? "SURE?" : "CLEAR MY MARKS"}
                        </button>
                      ) : null}
                      <button
                        className="drawing-party-button drawing-party-leave"
                        data-testid="public-leave"
                        disabled={publicDrawing.state === "ambient"}
                        onClick={publicDrawing.leave}
                        type="button"
                      >
                        RETURN TO AMBIENT
                      </button>
                    </>
                  )}
                </section>
              ) : (
                <button
                  aria-label={
                    clearConfirming
                      ? "Confirm clear drawing for this page"
                      : "Clear drawing for this page"
                  }
                  className="drawing-clear"
                  data-confirming={clearConfirming || undefined}
                  data-testid="drawing-clear"
                  onClick={handleClear}
                  type="button"
                >
                  {clearConfirming ? "SURE?" : "CLEAR"}
                </button>
              )}

              <button
                className="drawing-party-start"
                data-testid="party-start"
                onClick={handleStartParty}
                type="button"
              >
                START PARTY
              </button>

              {partyState === "unavailable" ? (
                <div className="drawing-party-panel" data-testid="party-panel">
                  <strong data-testid="party-live-status">
                    {partyStatusLabel(partyState)}
                  </strong>
                  <p data-testid="party-error" role="alert">
                    {partyError ||
                      "Realtime drawing has not been configured for this site."}
                  </p>
                </div>
              ) : null}
            </>
          ) : (
            <section
              aria-label="Drawing party"
              className="drawing-party-panel"
              data-testid="party-panel"
            >
              <div
                aria-atomic="true"
                aria-live="polite"
                className="drawing-party-heading"
                role="status"
              >
                <strong data-testid="party-live-status">
                  {partyStatusLabel(partyState)}
                </strong>
                <span data-testid="party-count">
                  {partyParticipants.length}/4
                </span>
              </div>

              {partyIdentity ? (
                <p className="drawing-party-identity">YOU: {partyIdentity.name}</p>
              ) : null}

              <label className="drawing-party-invite-label">
                INVITE LINK
                <input
                  className="drawing-party-share-link"
                  data-testid="party-share-link"
                  onFocus={(event) => event.currentTarget.select()}
                  readOnly
                  ref={shareLinkRef}
                  type="text"
                  value={partyShareUrl}
                />
              </label>

              <button
                className="drawing-party-button"
                data-testid="party-copy-link"
                onClick={() => void handleCopyInvite()}
                type="button"
              >
                COPY INVITE
              </button>
              <button
                aria-label={
                  clearConfirming
                    ? "Confirm clear your shared marks for this page"
                    : "Clear your shared marks for this page"
                }
                className="drawing-party-button"
                data-confirming={clearConfirming || undefined}
                data-testid="party-clear-mine"
                disabled={partyState !== "live"}
                onClick={handleClearMine}
                type="button"
              >
                {clearConfirming ? "SURE?" : "CLEAR MY MARKS"}
              </button>
              <button
                className="drawing-party-button drawing-party-leave"
                data-testid="party-leave"
                onClick={() => handleLeaveParty()}
                type="button"
              >
                LEAVE PARTY
              </button>

              {partyError ? (
                <p data-testid="party-error" role="alert">
                  {partyError}
                </p>
              ) : null}
            </section>
          )}
        </div>

        <span
          aria-live="polite"
          className={notSaving ? "drawing-save-status" : "sr-only"}
          role="status"
        >
          {notSaving ? "NOT SAVING" : ""}
        </span>

        <span
          aria-live="polite"
          className="drawing-action-status sr-only"
          role="status"
        >
          {statusMessage}
        </span>

        <div className="drawing-control-row">
          <button
            aria-controls="drawing-tools"
            aria-expanded={menuOpen}
            aria-label={menuOpen ? "Close drawing options" : "Open drawing options"}
            className="drawing-menu-toggle"
            data-testid="drawing-menu-toggle"
            onClick={() => {
              finishActiveStroke();
              hideMarker();
              setMenuOpen((open) => !open);
            }}
            ref={menuToggleRef}
            title="Drawing options"
            type="button"
          >
            <span aria-hidden="true">•••</span>
          </button>

          <button
            aria-controls="drawing-tools"
            aria-expanded={toolsVisible}
            aria-keyshortcuts="P"
            aria-label={
              enabled
                ? `Pause ${scope} drawing.${
                    publicDrawing.mode !== "off"
                      ? ` ${publicDrawing.sessionCount} sessions here.`
                      : ""
                  }`
                : `Start ${scope} drawing.${
                    publicDrawing.mode !== "off"
                      ? ` ${publicDrawing.sessionCount} sessions here.`
                      : ""
                  }`
            }
            aria-pressed={enabled}
            className="drawing-toggle"
            data-testid="drawing-toggle"
            onClick={() => {
              const activating = !enabledRef.current;
              handleToggle();
              if (activating) setMenuOpen(true);
            }}
            title={enabled ? "Pause drawing (P)" : "Start drawing (P)"}
            type="button"
          >
            <span aria-hidden="true" className="drawing-balloon">
              <span className="drawing-balloon-body" />
              <span className="drawing-balloon-knot" />
              <span className="drawing-balloon-string" />
            </span>
            {publicDrawing.mode !== "off" ? (
              <span
                aria-hidden="true"
                className="drawing-session-count"
                data-testid="drawing-session-count"
              >
                {shownSessionCount}
                {publicDrawing.sessionCount > 99 ? "+" : ""}
              </span>
            ) : null}
            <span className="sr-only">Drawing highlighter</span>
          </button>
        </div>
      </div>
    </div>
  );
}
