"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DRAWING_ANCHOR_SCHEMA_VERSION,
  documentPointToAnchoredPoint,
  normalizedBoundsFromPoints,
  type AnchoredPoint,
} from "../lib/drawingAnchors";
import { type HighlighterColor } from "./drawingStorage";
import {
  clearPublicMembership,
  parsePublicMessage,
  type PublicAnchoredStroke,
  type PublicCursor,
  type PublicDrawingState,
  type PublicIdentity,
  type PublicParticipant,
  type PublicPodAssignment,
  type PublicPodClientMessage,
  type PublicPodServerMessage,
  type PublicPresenceClientMessage,
  type PublicPresenceServerMessage,
  publicPodUrl,
  publicPresenceUrl,
  publicWebSocketProtocols,
  readPublicIdentity,
  readPublicMembership,
  storePublicIdentity,
  storePublicMembership,
} from "./publicDrawingClient";

const SEND_INTERVAL_MS = 50;
const PREVIEW_INTERVAL_MS = 100;
const FOREGROUND_IDLE_MS = 120_000;
const BACKGROUND_PRESENCE_GRACE_MS = 30_000;
const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_MATCH_ATTEMPTS = 3;

export type PublicDocumentPoint = { x: number; y: number };

type ActivePublicStroke = PublicAnchoredStroke & {
  rawDocumentPoint: PublicDocumentPoint;
  sentPointIndex: number;
};

type UsePublicDrawingOptions = {
  route: string;
  realtimeUrl: string;
  color: HighlighterColor;
  width: number;
  opacity: number;
  onRedraw: () => void;
  onStatus: (message: string) => void;
};

export type PublicDrawingController = {
  state: PublicDrawingState;
  mode: "off" | "presence" | "live";
  sessionCount: number;
  identity: PublicIdentity | null;
  participants: PublicParticipant[];
  cursors: PublicCursor[];
  strokesRef: React.RefObject<PublicAnchoredStroke[]>;
  mutedAuthors: ReadonlySet<string>;
  fadeAt: number | null;
  expiresAt: number | null;
  error: string;
  drawingReady: boolean;
  requestDrawing: () => void;
  requestWatching: () => void;
  pause: () => void;
  leave: () => void;
  retry: () => void;
  clearMine: () => boolean;
  toggleMute: (authorId: string) => void;
  addPoint: (point: PublicDocumentPoint, pointerId: number) => void;
  finishStroke: () => void;
  sendCursor: (point: AnchoredPoint, visible: boolean) => void;
  releaseForBackground: () => void;
};

function randomStrokeId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sendJson(
  socket: WebSocket | null,
  message: PublicPresenceClientMessage | PublicPodClientMessage,
): boolean {
  if (!socket || socket.readyState !== WebSocket.OPEN) return false;
  try {
    socket.send(JSON.stringify(message));
    return true;
  } catch {
    return false;
  }
}

function copyPublicStroke(stroke: PublicAnchoredStroke): PublicAnchoredStroke {
  return {
    ...stroke,
    points: [...stroke.points],
    bounds: { ...stroke.bounds },
  };
}

export function usePublicDrawing({
  route,
  realtimeUrl,
  color,
  width,
  opacity,
  onRedraw,
  onStatus,
}: UsePublicDrawingOptions): PublicDrawingController {
  const [state, setState] = useState<PublicDrawingState>(
    realtimeUrl ? "ambient" : "offline",
  );
  const [mode, setMode] = useState<"off" | "presence" | "live">(
    realtimeUrl ? "presence" : "off",
  );
  const [sessionCount, setSessionCount] = useState(1);
  const [identity, setIdentity] = useState<PublicIdentity | null>(null);
  const [assignment, setAssignment] = useState<PublicPodAssignment | null>(null);
  const [participants, setParticipants] = useState<PublicParticipant[]>([]);
  const [cursors, setCursors] = useState<PublicCursor[]>([]);
  const [mutedAuthors, setMutedAuthors] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [fadeAt, setFadeAt] = useState<number | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [connectionAttempt, setConnectionAttempt] = useState(0);

  const stateRef = useRef(state);
  const modeRef = useRef<"off" | "presence" | "live">(
    realtimeUrl ? "presence" : "off",
  );
  const presenceWelcomedRef = useRef(false);
  const identityRef = useRef<PublicIdentity | null>(null);
  const presenceSocketRef = useRef<WebSocket | null>(null);
  const podSocketRef = useRef<WebSocket | null>(null);
  const assignmentRef = useRef<PublicPodAssignment | null>(null);
  const strokesRef = useRef<PublicAnchoredStroke[]>([]);
  const activeStrokeRef = useRef<ActivePublicStroke | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const appendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const foregroundIdleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const backgroundTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceAttemptsRef = useRef(0);
  const matchAttemptsRef = useRef(0);
  const desiredRoleRef = useRef<"drawer" | "watcher" | null>(null);
  const resumeDrawingAfterRouteRef = useRef(false);
  const lastPreviewSentRef = useRef(0);
  const lastPodCursorSentRef = useRef(0);
  const cursorVisibleRef = useRef(false);
  const epochRef = useRef(0);
  const authorGenerationRef = useRef(0);
  const authorGenerationsRef = useRef(new Map<string, number>());
  const publicDisabledRef = useRef(false);
  const routeRef = useRef(route);
  const colorRef = useRef(color);

  const updateState = useCallback((next: PublicDrawingState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const clearForegroundIdleTimer = useCallback(() => {
    if (foregroundIdleTimerRef.current !== null) {
      clearTimeout(foregroundIdleTimerRef.current);
      foregroundIdleTimerRef.current = null;
    }
  }, []);

  const resetIdleTimer = useCallback(() => {
    clearForegroundIdleTimer();
    if (stateRef.current !== "drawing") return;
    foregroundIdleTimerRef.current = setTimeout(() => {
      foregroundIdleTimerRef.current = null;
      desiredRoleRef.current = null;
      if (cursorVisibleRef.current) {
        cursorVisibleRef.current = false;
        const cursorMessage = {
          type: "cursor:move" as const,
          anchorSchemaVersion: DRAWING_ANCHOR_SCHEMA_VERSION,
          anchorId: "page-root",
          x: 0,
          y: 0,
          color: colorRef.current,
          visible: false,
        };
        sendJson(presenceSocketRef.current, cursorMessage);
        sendJson(podSocketRef.current, cursorMessage);
      }
      sendJson(podSocketRef.current, { type: "seat:pause" });
      updateState("paused");
      onStatus("Public drawing paused after two minutes without movement.");
    }, FOREGROUND_IDLE_MS);
  }, [clearForegroundIdleTimer, onStatus, updateState]);

  const flushAppend = useCallback(() => {
    if (appendTimerRef.current !== null) {
      clearTimeout(appendTimerRef.current);
      appendTimerRef.current = null;
    }
    const stroke = activeStrokeRef.current;
    if (!stroke) return;

    while (stroke.sentPointIndex < stroke.points.length) {
      const start = stroke.sentPointIndex;
      const points = stroke.points.slice(start, start + 1_024);
      if (points.length < 2) return;
      const bounds = normalizedBoundsFromPoints(stroke.points);
      if (!bounds) return;
      const sequence = stroke.sequence + 1;
      if (
        !sendJson(podSocketRef.current, {
          type: "stroke:append",
          strokeId: stroke.id,
          anchorId: stroke.anchorId,
          anchorSchemaVersion: stroke.anchorSchemaVersion,
          sequence,
          points,
          bounds,
          epoch: stroke.epoch,
          authorGeneration: stroke.authorGeneration,
        })
      ) {
        return;
      }
      stroke.sequence = sequence;
      stroke.sentPointIndex = start + points.length;
      stroke.bounds = bounds;
    }
  }, []);

  const finishStroke = useCallback(() => {
    if (appendTimerRef.current !== null) {
      clearTimeout(appendTimerRef.current);
      appendTimerRef.current = null;
    }
    const stroke = activeStrokeRef.current;
    if (stroke) {
      flushAppend();
      sendJson(podSocketRef.current, {
        type: "stroke:end",
        strokeId: stroke.id,
        sequence: stroke.sequence + 1,
        epoch: stroke.epoch,
        authorGeneration: stroke.authorGeneration,
      });
    }
    activeStrokeRef.current = null;
    activePointerIdRef.current = null;
  }, [flushAppend]);

  const hideCursor = useCallback(() => {
    if (!cursorVisibleRef.current) return;
    cursorVisibleRef.current = false;
    const message = {
      type: "cursor:move" as const,
      anchorSchemaVersion: DRAWING_ANCHOR_SCHEMA_VERSION,
      anchorId: "page-root",
      x: 0,
      y: 0,
      color: colorRef.current,
      visible: false,
    };
    sendJson(presenceSocketRef.current, message);
    sendJson(podSocketRef.current, message);
  }, []);

  const pause = useCallback(() => {
    clearForegroundIdleTimer();
    finishStroke();
    hideCursor();
    desiredRoleRef.current = null;
    const currentState = stateRef.current;
    if (currentState === "drawing" || currentState === "matching") {
      sendJson(podSocketRef.current, { type: "seat:pause" });
      if (currentState === "matching") {
        sendJson(presenceSocketRef.current, {
          type: "match:release",
          podId: assignmentRef.current?.podId,
        });
      }
      updateState("paused");
      onStatus("Public drawing paused. Your seat is held for two minutes.");
    }
  }, [clearForegroundIdleTimer, finishStroke, hideCursor, onStatus, updateState]);

  const closePod = useCallback((reason: string) => {
    clearForegroundIdleTimer();
    finishStroke();
    hideCursor();
    const socket = podSocketRef.current;
    podSocketRef.current = null;
    socket?.close(1000, reason);
    assignmentRef.current = null;
    setAssignment(null);
    setParticipants([]);
    setCursors([]);
  }, [clearForegroundIdleTimer, finishStroke, hideCursor]);

  const transitionToPresenceOnly = useCallback(
    (message: string) => {
      const podId = assignmentRef.current?.podId;
      finishStroke();
      sendJson(podSocketRef.current, { type: "seat:release" });
      sendJson(presenceSocketRef.current, {
        type: "match:release",
        podId,
      });
      desiredRoleRef.current = null;
      resumeDrawingAfterRouteRef.current = false;
      clearPublicMembership();
      closePod("Live drawing is watch-only");
      strokesRef.current = [];
      setMutedAuthors(new Set());
      setFadeAt(null);
      setExpiresAt(null);
      modeRef.current = "presence";
      setMode("presence");
      updateState("watching");
      setError(message);
      onRedraw();
    },
    [closePod, finishStroke, onRedraw, updateState],
  );

  const requestRole = useCallback(
    (role: "drawer" | "watcher") => {
      desiredRoleRef.current = role;
      matchAttemptsRef.current = 0;

      if (!presenceWelcomedRef.current) {
        updateState("matching");
        return;
      }

      if (modeRef.current !== "live") {
        updateState(modeRef.current === "off" ? "offline" : "watching");
        onStatus(
          modeRef.current === "off"
            ? "Live drawing is offline."
            : "Live drawing is currently watch-only.",
        );
        return;
      }

      const socket = podSocketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        if (role === "drawer") {
          sendJson(socket, { type: "seat:promote" });
          updateState("matching");
        } else {
          updateState("watching");
        }
        return;
      }

      updateState("matching");
      const preferredPodId = readPublicMembership(routeRef.current)?.podId;
      if (
        !sendJson(presenceSocketRef.current, {
          type: "match:request",
          role,
          preferredPodId,
        })
      ) {
        setError("Live drawing is reconnecting.");
      }
    },
    [onStatus, updateState],
  );

  const requestDrawing = useCallback(() => requestRole("drawer"), [requestRole]);
  const requestWatching = useCallback(() => requestRole("watcher"), [requestRole]);

  const leave = useCallback(() => {
    desiredRoleRef.current = null;
    clearPublicMembership();
    sendJson(podSocketRef.current, { type: "seat:release" });
    closePod("Returning to ambient");
    strokesRef.current = [];
    setMutedAuthors(new Set());
    setFadeAt(null);
    setExpiresAt(null);
    updateState("ambient");
    onRedraw();
    onStatus("You left the public drawing pod.");
  }, [closePod, onRedraw, onStatus, updateState]);

  const clearMine = useCallback(() => {
    finishStroke();
    return sendJson(podSocketRef.current, { type: "clear:mine" });
  }, [finishStroke]);

  const retry = useCallback(() => {
    if (publicDisabledRef.current) return;
    setError("");
    presenceAttemptsRef.current = 0;
    setConnectionAttempt((attempt) => attempt + 1);
  }, []);

  const toggleMute = useCallback(
    (authorId: string) => {
      setMutedAuthors((current) => {
        const next = new Set(current);
        if (next.has(authorId)) next.delete(authorId);
        else next.add(authorId);
        return next;
      });
      onRedraw();
    },
    [onRedraw],
  );

  const queueAppend = useCallback(() => {
    if (appendTimerRef.current !== null) return;
    appendTimerRef.current = setTimeout(flushAppend, SEND_INTERVAL_MS);
  }, [flushAppend]);

  const addPoint = useCallback(
    (point: PublicDocumentPoint, pointerId: number) => {
      if (stateRef.current !== "drawing") return;
      const anchored = documentPointToAnchoredPoint(point.x, point.y);
      if (!anchored) {
        finishStroke();
        return;
      }

      if (
        activePointerIdRef.current !== null &&
        activePointerIdRef.current !== pointerId
      ) {
        finishStroke();
      }

      let stroke = activeStrokeRef.current;
      if (stroke && stroke.anchorId !== anchored.anchorId) {
        finishStroke();
        stroke = null;
      }

      if (!stroke) {
        const activeIdentity = identityRef.current;
        if (!activeIdentity) return;
        const now = Date.now();
        const newStroke: ActivePublicStroke = {
          version: 2,
          id: randomStrokeId(),
          route: routeRef.current,
          authorId: activeIdentity.id,
          authorName: activeIdentity.name,
          authorGeneration: authorGenerationRef.current,
          color: colorRef.current,
          width,
          opacity,
          createdAt: now,
          anchorSchemaVersion: anchored.anchorSchemaVersion,
          anchorId: anchored.anchorId,
          points: [anchored.x, anchored.y],
          bounds: {
            minX: anchored.x,
            minY: anchored.y,
            maxX: anchored.x,
            maxY: anchored.y,
          },
          sequence: 0,
          epoch: epochRef.current,
          rawDocumentPoint: point,
          sentPointIndex: 2,
        };
        activeStrokeRef.current = newStroke;
        activePointerIdRef.current = pointerId;
        strokesRef.current = [...strokesRef.current, newStroke];
        sendJson(podSocketRef.current, {
          type: "stroke:start",
          stroke: {
            version: 2,
            id: newStroke.id,
            route: newStroke.route,
            color: newStroke.color,
            width: newStroke.width,
            opacity: newStroke.opacity,
            createdAt: newStroke.createdAt,
            anchorSchemaVersion: newStroke.anchorSchemaVersion,
            anchorId: newStroke.anchorId,
            points: [...newStroke.points],
            bounds: { ...newStroke.bounds },
            sequence: newStroke.sequence,
            epoch: newStroke.epoch,
            authorGeneration: newStroke.authorGeneration,
          },
        });
        resetIdleTimer();
        onRedraw();
        return;
      }

      const distance = Math.hypot(
        point.x - stroke.rawDocumentPoint.x,
        point.y - stroke.rawDocumentPoint.y,
      );
      if (distance >= 3) {
        const sampleCount = Math.floor(distance / 3);
        const rawDeltaX = point.x - stroke.rawDocumentPoint.x;
        const rawDeltaY = point.y - stroke.rawDocumentPoint.y;
        const startX = stroke.points[stroke.points.length - 2];
        const startY = stroke.points[stroke.points.length - 1];
        const sampledPoints = [...stroke.points];
        for (let index = 1; index <= sampleCount; index += 1) {
          const ratio = (index * 3) / distance;
          sampledPoints.push(
            startX + (anchored.x - startX) * ratio,
            startY + (anchored.y - startY) * ratio,
          );
        }
        const sampledRatio = (sampleCount * 3) / distance;
        const nextStroke: ActivePublicStroke = {
          ...stroke,
          points: sampledPoints,
          rawDocumentPoint: {
            x: stroke.rawDocumentPoint.x + rawDeltaX * sampledRatio,
            y: stroke.rawDocumentPoint.y + rawDeltaY * sampledRatio,
          },
        };
        const bounds = normalizedBoundsFromPoints(nextStroke.points);
        if (bounds) {
          nextStroke.bounds = bounds;
        }
        activeStrokeRef.current = nextStroke;
        strokesRef.current = strokesRef.current.map((candidate) =>
          candidate.id === nextStroke.id &&
          candidate.authorId === nextStroke.authorId
            ? nextStroke
            : candidate,
        );
        queueAppend();
        onRedraw();
      }
      resetIdleTimer();
    },
    [finishStroke, onRedraw, opacity, queueAppend, resetIdleTimer, width],
  );

  const sendCursor = useCallback((point: AnchoredPoint, visible: boolean) => {
    const now = performance.now();
    const message = {
      type: "cursor:move" as const,
      anchorSchemaVersion: point.anchorSchemaVersion,
      anchorId: point.anchorId,
      x: point.x,
      y: point.y,
      color: colorRef.current,
      visible,
    };
    if (now - lastPreviewSentRef.current >= PREVIEW_INTERVAL_MS || !visible) {
      lastPreviewSentRef.current = now;
      sendJson(presenceSocketRef.current, message);
    }
    if (now - lastPodCursorSentRef.current >= SEND_INTERVAL_MS || !visible) {
      lastPodCursorSentRef.current = now;
      sendJson(podSocketRef.current, message);
    }
    cursorVisibleRef.current = visible;
  }, []);

  const releaseForBackground = useCallback(() => {
    finishStroke();
    hideCursor();
    if (podSocketRef.current) {
      sendJson(podSocketRef.current, { type: "seat:release" });
      closePod("Page hidden");
      updateState("paused");
    }
    if (backgroundTimerRef.current !== null) {
      clearTimeout(backgroundTimerRef.current);
    }
    backgroundTimerRef.current = setTimeout(() => {
      backgroundTimerRef.current = null;
      const socket = presenceSocketRef.current;
      presenceSocketRef.current = null;
      socket?.close(1000, "Background presence grace expired");
    }, BACKGROUND_PRESENCE_GRACE_MS);
  }, [closePod, finishStroke, hideCursor, updateState]);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  useEffect(() => {
    identityRef.current = identity;
  }, [identity]);

  useEffect(() => {
    assignmentRef.current = assignment;
  }, [assignment]);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);

  useEffect(() => {
    if (cursors.length === 0) return;
    const timer = window.setInterval(() => {
      const cutoff = Date.now() - 5_000;
      setCursors((current) =>
        current.some(({ seenAt }) => seenAt < cutoff)
          ? current.filter(({ seenAt }) => seenAt >= cutoff)
          : current,
      );
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [cursors.length]);

  useEffect(() => {
    const previousRoute = routeRef.current;
    if (previousRoute === route) return;
    const wasDrawing = stateRef.current === "drawing";
    resumeDrawingAfterRouteRef.current = wasDrawing;
    routeRef.current = route;
    desiredRoleRef.current = wasDrawing ? "drawer" : null;
    updateState(wasDrawing ? "matching" : "ambient");
    closePod("Changing page");
    strokesRef.current = [];
    setMutedAuthors(new Set());
    setFadeAt(null);
    setExpiresAt(null);
    onRedraw();
  }, [closePod, onRedraw, route, updateState]);

  useEffect(() => {
    if (!realtimeUrl) {
      // A missing build-time endpoint is external configuration, not derived
      // UI state; synchronize it once this client component has mounted.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      updateState("offline");
      setMode("off");
      setError("Realtime drawing has not been configured for this site.");
      return;
    }

    let disposed = false;
    let socket: WebSocket | null = null;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    function stopHeartbeat() {
      if (heartbeatTimer !== null) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    }

    function scheduleReconnect() {
      if (
        disposed ||
        publicDisabledRef.current ||
        reconnectTimerRef.current !== null
      ) {
        return;
      }
      presenceAttemptsRef.current += 1;
      if (presenceAttemptsRef.current > 4) {
        updateState("offline");
        setError("Live drawing is offline.");
        return;
      }
      const delay = Math.min(8_000, 500 * 2 ** (presenceAttemptsRef.current - 1));
      reconnectTimerRef.current = setTimeout(() => {
        reconnectTimerRef.current = null;
        connect();
      }, delay);
    }

    function handleMessage(message: PublicPresenceServerMessage) {
      switch (message.type) {
        case "presence:welcome": {
          presenceAttemptsRef.current = 0;
          presenceWelcomedRef.current = true;
          modeRef.current = message.mode;
          setMode(message.mode);
          setSessionCount(Math.max(1, message.sessionCount));
          identityRef.current = message.self;
          setIdentity(message.self);
          storePublicIdentity(message.self);
          setError("");
          if (message.mode === "live") {
            const reconnectPaused =
              readPublicMembership(routeRef.current) !== null;
            if (resumeDrawingAfterRouteRef.current) {
              resumeDrawingAfterRouteRef.current = false;
              requestRole("drawer");
            } else if (desiredRoleRef.current) {
              requestRole(desiredRoleRef.current);
            } else if (reconnectPaused) {
              desiredRoleRef.current = "watcher";
              requestRole("watcher");
            } else if (stateRef.current === "offline") {
              updateState("ambient");
            }
          } else if (message.mode === "presence") {
            updateState("watching");
          }
          break;
        }
        case "presence:count":
          setSessionCount(Math.max(1, message.sessionCount));
          break;
        case "cursor:move":
          if (message.authorId === identityRef.current?.id) break;
          if (assignmentRef.current || podSocketRef.current) break;
          setCursors((current) => {
            const rest = current.filter(({ authorId }) => authorId !== message.authorId);
            return message.visible
              ? [
                  ...rest.slice(-2),
                  {
                    ...message,
                    seenAt: Date.now(),
                  },
                ]
              : rest;
          });
          break;
        case "match:assignment":
          matchAttemptsRef.current = 0;
          setCursors([]);
          assignmentRef.current = message.assignment;
          setAssignment(message.assignment);
          break;
        case "error":
          setError(message.message);
          if (message.code === "PUBLIC_DISABLED") {
            publicDisabledRef.current = true;
            presenceWelcomedRef.current = false;
            desiredRoleRef.current = null;
            modeRef.current = "off";
            setMode("off");
            updateState("offline");
            closePod("Public drawing disabled");
            socket?.close(1000, "Public drawing disabled");
          } else if (message.code === "LIVE_DISABLED") {
            transitionToPresenceOnly(message.message);
          } else if (
            message.code === "LIVE_BUSY" ||
            message.code === "ROUTE_FULL"
          ) {
            updateState("busy");
          } else if (message.fatal) {
            updateState("offline");
          }
          break;
        case "pong":
          break;
      }
    }

    function connect() {
      if (disposed || publicDisabledRef.current || !navigator.onLine) {
        updateState("offline");
        return;
      }
      const storedIdentity = identityRef.current ?? readPublicIdentity();
      presenceWelcomedRef.current = false;
      try {
        socket = new WebSocket(
          publicPresenceUrl(realtimeUrl, route, storedIdentity),
          publicWebSocketProtocols(storedIdentity?.token),
        );
      } catch {
        setError("The realtime drawing address is invalid.");
        updateState("offline");
        return;
      }
      presenceSocketRef.current = socket;
      socket.addEventListener("open", () => {
        stopHeartbeat();
        heartbeatTimer = setInterval(() => {
          sendJson(socket, {
            type: "ping",
            nonce: Date.now().toString(36),
          });
        }, HEARTBEAT_INTERVAL_MS);
      });
      socket.addEventListener("message", (event) => {
        if (disposed || presenceSocketRef.current !== socket) return;
        const message = parsePublicMessage<PublicPresenceServerMessage>(event.data);
        if (message) handleMessage(message);
      });
      socket.addEventListener("close", () => {
        if (disposed || presenceSocketRef.current !== socket) return;
        stopHeartbeat();
        presenceSocketRef.current = null;
        scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        if (!disposed) setError("Live presence was interrupted.");
      });
    }

    function handleOnline() {
      if (!publicDisabledRef.current && !presenceSocketRef.current) connect();
    }
    function handleOffline() {
      setError("You are offline.");
      updateState("offline");
    }
    function handleVisible() {
      if (document.visibilityState !== "visible") return;
      if (backgroundTimerRef.current !== null) {
        clearTimeout(backgroundTimerRef.current);
        backgroundTimerRef.current = null;
      }
      if (!publicDisabledRef.current && !presenceSocketRef.current) {
        connect();
      } else if (
        modeRef.current === "live" &&
        !podSocketRef.current &&
        readPublicMembership(routeRef.current)
      ) {
        desiredRoleRef.current = "watcher";
        requestRole("watcher");
      }
    }

    connect();
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    document.addEventListener("visibilitychange", handleVisible);

    return () => {
      disposed = true;
      presenceWelcomedRef.current = false;
      stopHeartbeat();
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      document.removeEventListener("visibilitychange", handleVisible);
      if (reconnectTimerRef.current !== null) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (presenceSocketRef.current === socket) presenceSocketRef.current = null;
      socket?.close(1000, "Presence route changed");
    };
  }, [
    closePod,
    connectionAttempt,
    realtimeUrl,
    requestRole,
    route,
    transitionToPresenceOnly,
    updateState,
  ]);

  useEffect(() => {
    if (!assignment || !identity || !realtimeUrl) return;
    const currentAssignment = assignment;
    let disposed = false;
    let socket: WebSocket;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null;

    function installSnapshot(
      strokes: PublicAnchoredStroke[] | undefined,
      nextEpoch: number,
    ) {
      epochRef.current = nextEpoch;
      strokesRef.current = (strokes ?? []).map(copyPublicStroke);
      authorGenerationsRef.current = new Map();
      for (const stroke of strokesRef.current) {
        const current = authorGenerationsRef.current.get(stroke.authorId) ?? -1;
        if (stroke.authorGeneration > current) {
          authorGenerationsRef.current.set(
            stroke.authorId,
            stroke.authorGeneration,
          );
        }
      }
      onRedraw();
    }

    function rematch(message: string) {
      if (disposed) return;
      closePod("Pod rematch");
      matchAttemptsRef.current += 1;
      if (matchAttemptsRef.current > MAX_MATCH_ATTEMPTS) {
        updateState("busy");
        setError(message);
        return;
      }
      const delay = 120 + Math.floor(Math.random() * 240);
      window.setTimeout(() => {
        if (desiredRoleRef.current) requestRole(desiredRoleRef.current);
      }, delay);
    }

    function handleMessage(message: PublicPodServerMessage) {
      switch (message.type) {
        case "pod:welcome":
          authorGenerationRef.current = message.selfAuthorGeneration;
          setParticipants(message.participants);
          setFadeAt(message.fadeAt ?? null);
          setExpiresAt(message.expiresAt ?? null);
          installSnapshot(message.strokes, message.epoch);
          authorGenerationsRef.current.set(
            message.selfId,
            message.selfAuthorGeneration,
          );
          setError("");
          storePublicMembership({
            version: 1,
            podId: message.podId,
            route: routeRef.current,
          });
          if (message.role === "drawer") {
            if (
              desiredRoleRef.current === null &&
              stateRef.current === "paused"
            ) {
              sendJson(socket, { type: "seat:pause" });
              updateState("paused");
            } else {
              updateState("drawing");
              resetIdleTimer();
              onStatus("Public drawing is live.");
            }
          } else {
            updateState("watching");
            onStatus("Watching this public drawing pod.");
          }
          break;
        case "pod:snapshot":
          authorGenerationRef.current = message.selfAuthorGeneration;
          setParticipants(message.participants);
          setFadeAt(message.fadeAt ?? null);
          setExpiresAt(message.expiresAt ?? null);
          installSnapshot(message.strokes, message.epoch);
          if (identityRef.current) {
            authorGenerationsRef.current.set(
              identityRef.current.id,
              message.selfAuthorGeneration,
            );
          }
          if (
            desiredRoleRef.current === "drawer" &&
            message.participants.some(
              ({ id, drawing }) => id === identityRef.current?.id && drawing,
            )
          ) {
            updateState("drawing");
            resetIdleTimer();
            onStatus("Public drawing is live.");
          } else if (stateRef.current !== "paused") {
            updateState("watching");
          }
          break;
        case "pod:presence":
          setParticipants(message.participants);
          break;
        case "pod:lifecycle":
          if (message.epoch !== epochRef.current) break;
          setFadeAt(message.fadeAt);
          setExpiresAt(message.expiresAt);
          onRedraw();
          break;
        case "cursor:move":
          if (message.authorId === identityRef.current?.id) break;
          setCursors((current) => {
            const rest = current.filter(({ authorId }) => authorId !== message.authorId);
            return message.visible
              ? [
                  ...rest,
                  {
                    ...message,
                    seenAt: Date.now(),
                  },
                ]
              : rest;
          });
          break;
        case "stroke:start":
          if (message.stroke.epoch !== epochRef.current) break;
          if (
            message.stroke.authorGeneration <
            (authorGenerationsRef.current.get(message.stroke.authorId) ?? -1)
          ) {
            break;
          }
          authorGenerationsRef.current.set(
            message.stroke.authorId,
            message.stroke.authorGeneration,
          );
          if (
            !strokesRef.current.some(
              ({ id, authorId }) =>
                id === message.stroke.id && authorId === message.stroke.authorId,
            )
          ) {
            strokesRef.current = [
              ...strokesRef.current,
              copyPublicStroke(message.stroke),
            ];
            onRedraw();
          }
          break;
        case "stroke:append": {
          if (message.epoch !== epochRef.current) break;
          const stroke = strokesRef.current.find(
            ({ id, authorId }) =>
              id === message.strokeId && authorId === message.authorId,
          );
          if (
            !stroke ||
            message.authorGeneration !== stroke.authorGeneration ||
            message.sequence <= stroke.sequence
          ) {
            break;
          }
          stroke.points.push(...message.points);
          stroke.bounds = { ...message.bounds };
          stroke.sequence = message.sequence;
          onRedraw();
          break;
        }
        case "strokes:cleared":
          if (message.epoch !== epochRef.current) break;
          authorGenerationsRef.current.set(
            message.authorId,
            message.authorGeneration,
          );
          strokesRef.current = strokesRef.current.filter(
            ({ authorId }) => authorId !== message.authorId,
          );
          onRedraw();
          if (message.authorId === identityRef.current?.id) {
            authorGenerationRef.current = message.authorGeneration;
            onStatus("Your public marks were cleared.");
          }
          break;
        case "pod:expired":
          epochRef.current = message.epoch;
          authorGenerationsRef.current.clear();
          strokesRef.current = [];
          clearPublicMembership();
          setFadeAt(null);
          setExpiresAt(null);
          onRedraw();
          break;
        case "error":
          setError(message.message);
          if (message.code === "PUBLIC_DISABLED") {
            publicDisabledRef.current = true;
            desiredRoleRef.current = null;
            modeRef.current = "off";
            setMode("off");
            updateState("offline");
            presenceSocketRef.current?.close(1000, "Public drawing disabled");
            closePod("Public drawing disabled");
            break;
          }
          if (message.code === "LIVE_DISABLED") {
            transitionToPresenceOnly(message.message);
            break;
          }
          if (
            message.code === "SEAT_TAKEN" ||
            message.code === "POD_FULL" ||
            message.code === "GRANT_EXPIRED"
          ) {
            rematch(message.message);
          } else if (message.fatal) {
            updateState("offline");
          }
          break;
        case "stroke:end":
        case "pong":
          break;
      }
    }

    try {
      socket = new WebSocket(
        publicPodUrl(realtimeUrl, currentAssignment, route, identity),
        publicWebSocketProtocols(identity.token),
      );
    } catch {
      rematch("Could not connect to a public drawing pod.");
      return;
    }

    podSocketRef.current = socket;
    socket.addEventListener("open", () => {
      heartbeatTimer = setInterval(() => {
        sendJson(socket, {
          type: "ping",
          nonce: Date.now().toString(36),
        });
      }, HEARTBEAT_INTERVAL_MS);
    });
    socket.addEventListener("message", (event) => {
      if (disposed || podSocketRef.current !== socket) return;
      const message = parsePublicMessage<PublicPodServerMessage>(event.data);
      if (message) handleMessage(message);
    });
    socket.addEventListener("close", (event) => {
      if (disposed || podSocketRef.current !== socket) return;
      podSocketRef.current = null;
      if (
        !publicDisabledRef.current &&
        event.code !== 1000 &&
        desiredRoleRef.current
      ) {
        rematch("The public drawing pod disconnected.");
      }
    });
    socket.addEventListener("error", () => {
      if (!disposed) setError("The public drawing pod was interrupted.");
    });

    return () => {
      disposed = true;
      if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
      if (podSocketRef.current === socket) podSocketRef.current = null;
      socket.close(1000, "Pod assignment changed");
    };
  }, [
    assignment,
    closePod,
    identity,
    onRedraw,
    onStatus,
    realtimeUrl,
    requestRole,
    resetIdleTimer,
    route,
    transitionToPresenceOnly,
    updateState,
  ]);

  useEffect(() => {
    return () => {
      finishStroke();
      if (appendTimerRef.current !== null) clearTimeout(appendTimerRef.current);
      if (foregroundIdleTimerRef.current !== null) {
        clearTimeout(foregroundIdleTimerRef.current);
      }
      if (backgroundTimerRef.current !== null) {
        clearTimeout(backgroundTimerRef.current);
      }
      podSocketRef.current?.close(1000, "Drawing client unmounted");
      presenceSocketRef.current?.close(1000, "Drawing client unmounted");
    };
  }, [finishStroke]);

  return {
    state,
    mode,
    sessionCount,
    identity,
    participants,
    cursors,
    strokesRef,
    mutedAuthors,
    fadeAt,
    expiresAt,
    error,
    drawingReady: state === "drawing",
    requestDrawing,
    requestWatching,
    pause,
    leave,
    retry,
    clearMine,
    toggleMute,
    addPoint,
    finishStroke,
    sendCursor,
    releaseForBackground,
  };
}
