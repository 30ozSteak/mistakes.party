"use client";

import { usePathname } from "next/navigation";
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
  PARTY_HOUSE_ROOM_ZONES,
  PARTY_HOUSE_SESSION_STORAGE_KEY,
  isPartyHouseGeneration,
  isPartyHouseSessionId,
  parsePartyHouseServerMessageJson,
  partyHouseRoomForLight,
  partyHouseRealtimeWebSocketProtocols,
  partyHouseRealtimeWebSocketUrl,
  type PartyHouseAfterglow,
  type PartyHouseEnergy,
  type PartyHouseLight,
  type PartyHouseMode,
  type PartyHouseRoom,
  type PartyHouseServerMessage,
  type PartyHouseZone,
} from "../lib/partyHouseProtocol";
import { PARTY_REALTIME_URL } from "../lib/partyRealtimeConfig";
import styles from "./PartyHouse.module.css";

const HEARTBEAT_MS = 25_000;
const HELLO_TIMEOUT_MS = 10_000;
const HIDDEN_RELEASE_MS = 30_000;
const BALLOON_ACK_TIMEOUT_MS = 8_000;
const BALLOON_CONFIRMATION_MS = 2_600;
const BALLOON_LIFETIME_MS = 4_200;
const MAX_VISIBLE_BALLOONS = 4;
const PEER_ANNOUNCEMENT_INTERVAL_MS = 5_000;
const MOTION_INTERVAL_MS = 500;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];

const EMPTY_AFTERGLOW: PartyHouseAfterglow = {
  weights: [0, 0, 0, 0],
  intensity: 0,
  asOf: 0,
  windowMs: PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
};

type PartyHouseConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "full"
  | "off";

// The v2 Worker retains the legacy `knock` wire name for compatibility. The
// client presents those anonymous events as guestbook balloons.
export type PartyHouseBalloon = Extract<
  PartyHouseServerMessage,
  { type: "knock" }
>;

type StoredPartyHouseSession = {
  generation: string;
  sessionId: string;
  hasLeftBalloon: boolean;
  motionPreference: "on" | "off" | null;
};

type PartyHouseContextValue = {
  afterglow: PartyHouseAfterglow;
  configured: boolean;
  connectionState: PartyHouseConnectionState;
  eligible: boolean;
  balloonAvailable: boolean;
  balloonConfirmed: boolean;
  balloonPending: boolean;
  balloons: PartyHouseBalloon[];
  hasLeftBalloon: boolean;
  hydrated: boolean;
  leaveBalloon: () => void;
  lights: PartyHouseLight[];
  mode: PartyHouseMode | null;
  motionEnabled: boolean;
  presenceCount: number | null;
  room: PartyHouseRoom;
  roomCounts: Record<Exclude<PartyHouseRoom, "lobby">, number>;
  self: PartyHouseLight | null;
  setRoom: (room: PartyHouseRoom) => void;
  setMotionEnabled: (enabled: boolean) => void;
  swell: number;
};

const PartyHouseContext = createContext<PartyHouseContextValue | null>(null);

function isEligiblePartyPathname(pathname: string): boolean {
  return pathname !== "/patreon" && !pathname.startsWith("/patreon/");
}

function readStoredSession(): StoredPartyHouseSession | null {
  try {
    const value: unknown = JSON.parse(
      window.sessionStorage.getItem(PARTY_HOUSE_SESSION_STORAGE_KEY) ?? "null",
    );
    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value)
    ) {
      return null;
    }
    const record = value as Record<string, unknown>;
    if (
      !isPartyHouseGeneration(record.generation) ||
      !isPartyHouseSessionId(record.sessionId) ||
      (record.motionPreference !== null &&
        record.motionPreference !== "on" &&
        record.motionPreference !== "off")
    ) {
      return null;
    }
    const hasLeftBalloon =
      typeof record.hasLeftBalloon === "boolean"
        ? record.hasLeftBalloon
        : typeof record.hasKnocked === "boolean"
          ? record.hasKnocked
          : null;
    if (hasLeftBalloon === null) return null;

    return {
      generation: record.generation,
      sessionId: record.sessionId,
      hasLeftBalloon,
      motionPreference: record.motionPreference,
    };
  } catch {
    return null;
  }
}

function writeStoredSession(value: StoredPartyHouseSession | null): void {
  try {
    if (value) {
      window.sessionStorage.setItem(
        PARTY_HOUSE_SESSION_STORAGE_KEY,
        JSON.stringify(value),
      );
    } else {
      window.sessionStorage.removeItem(PARTY_HOUSE_SESSION_STORAGE_KEY);
    }
  } catch {
    // The room still works; reconnects may briefly look like a new light.
  }
}

function PathnameObserver({
  onPathname,
}: {
  onPathname: (pathname: string) => void;
}) {
  const pathname = usePathname();

  useEffect(() => {
    onPathname(pathname);
  }, [onPathname, pathname]);
  return null;
}

function isSocketOpen(socket: WebSocket | null): socket is WebSocket {
  return socket !== null && socket.readyState === WebSocket.OPEN;
}

export function PartyHouseProvider({ children }: { children: ReactNode }) {
  const configured = PARTY_REALTIME_URL.length > 0;
  const [hydrated, setHydrated] = useState(false);
  const [eligible, setEligible] = useState(false);
  const [connectionState, setConnectionState] =
    useState<PartyHouseConnectionState>("idle");
  const [mode, setMode] = useState<PartyHouseMode | null>(null);
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const [self, setSelf] = useState<PartyHouseLight | null>(null);
  const [lights, setLights] = useState<PartyHouseLight[]>([]);
  const [afterglow, setAfterglow] =
    useState<PartyHouseAfterglow>(EMPTY_AFTERGLOW);
  const [balloons, setBalloons] = useState<PartyHouseBalloon[]>([]);
  const [swell, setSwell] = useState(0);
  const [balloonConfirmed, setBalloonConfirmed] = useState(false);
  const [balloonPending, setBalloonPending] = useState(false);
  const [hasLeftBalloon, setHasLeftBalloon] = useState(false);
  const [announcement, setAnnouncement] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const [motionEnabled, setMotionEnabledState] = useState(false);
  const [room, setRoomState] = useState<PartyHouseRoom>("lobby");

  const socketRef = useRef<WebSocket | null>(null);
  const modeRef = useRef<PartyHouseMode | null>(null);
  const selfRef = useRef<PartyHouseLight | null>(null);
  const storedSessionRef = useRef<StoredPartyHouseSession | null>(null);
  const balloonPendingRef = useRef(false);
  const hasLeftBalloonRef = useRef(false);
  const pendingBalloonTimersRef = useRef(new Map<string, number>());
  const balloonTimersRef = useRef(new Set<number>());
  const visibleBalloonsRef = useRef<PartyHouseBalloon[]>([]);
  const confirmationTimerRef = useRef<number | null>(null);
  const roomMotionTimerRef = useRef<number | null>(null);
  const peerAnnouncementTimerRef = useRef<number | null>(null);
  const queuedPeerAnnouncementRef = useRef("Someone changed the house.");
  const lastPeerAnnouncementRef = useRef(0);
  const announcementIdRef = useRef(0);
  const presenceCountRef = useRef<number | null>(null);

  const clearHouseData = useCallback(() => {
    balloonTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    balloonTimersRef.current.clear();
    pendingBalloonTimersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    pendingBalloonTimersRef.current.clear();
    if (confirmationTimerRef.current !== null) {
      window.clearTimeout(confirmationTimerRef.current);
      confirmationTimerRef.current = null;
    }
    if (roomMotionTimerRef.current !== null) {
      window.clearTimeout(roomMotionTimerRef.current);
      roomMotionTimerRef.current = null;
    }
    modeRef.current = null;
    selfRef.current = null;
    presenceCountRef.current = null;
    visibleBalloonsRef.current = [];
    balloonPendingRef.current = false;
    setMode(null);
    setSelf(null);
    setLights([]);
    setBalloons([]);
    setBalloonPending(false);
    setPresenceCount(null);
    setAfterglow(EMPTY_AFTERGLOW);
    setSwell(0);
    setBalloonConfirmed(false);
  }, []);
  const clearHouseView = useCallback(() => {
    clearHouseData();
    setConnectionState("idle");
  }, [clearHouseData]);
  const motionEnabledRef = useRef(false);
  const motionUnlockedRef = useRef(false);
  const roomRef = useRef<PartyHouseRoom>("lobby");
  const lastMotionSentRef = useRef({ key: "", at: 0 });
  const motionWasSharedRef = useRef(false);
  const announcementTimerRef = useRef<number | null>(null);

  const handlePathname = useCallback((pathname: string) => {
    setHydrated(true);
    setEligible(isEligiblePartyPathname(pathname));
  }, []);

  const sendMotion = useCallback(
    (
      zone: PartyHouseZone,
      energy: PartyHouseEnergy,
      sharing: boolean,
      force = false,
    ) => {
      const socket = socketRef.current;
      if (!isSocketOpen(socket) || modeRef.current !== "live") return;
      if (
        sharing &&
        (!motionUnlockedRef.current ||
          !motionEnabledRef.current ||
          document.visibilityState !== "visible")
      ) {
        return;
      }
      const now = performance.now();
      const key = `${zone}:${energy}:${sharing}`;
      if (
        !force &&
        (key === lastMotionSentRef.current.key ||
          now - lastMotionSentRef.current.at < MOTION_INTERVAL_MS)
      ) {
        return;
      }
      socket.send(
        JSON.stringify({ type: "light:move", zone, energy, sharing }),
      );
      lastMotionSentRef.current = { key, at: now };
      motionWasSharedRef.current = sharing;
    },
    [],
  );

  const disableOutgoingMotion = useCallback(() => {
    if (roomMotionTimerRef.current !== null) {
      window.clearTimeout(roomMotionTimerRef.current);
      roomMotionTimerRef.current = null;
    }
    if (!motionUnlockedRef.current || !motionWasSharedRef.current) return;
    sendMotion(PARTY_HOUSE_ROOM_ZONES.lobby, 0, false, true);
    lastMotionSentRef.current = { key: "", at: 0 };
    motionWasSharedRef.current = false;
  }, [sendMotion]);

  const setRoom = useCallback(
    (nextRoom: PartyHouseRoom) => {
      roomRef.current = nextRoom;
      setRoomState(nextRoom);
      if (
        !motionUnlockedRef.current ||
        !motionEnabledRef.current ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      const sharing = nextRoom !== "lobby";
      sendMotion(PARTY_HOUSE_ROOM_ZONES[nextRoom], 0, sharing);
      if (roomMotionTimerRef.current !== null) {
        window.clearTimeout(roomMotionTimerRef.current);
      }
      roomMotionTimerRef.current = window.setTimeout(() => {
        roomMotionTimerRef.current = null;
        const latestRoom = roomRef.current;
        sendMotion(
          PARTY_HOUSE_ROOM_ZONES[latestRoom],
          0,
          latestRoom !== "lobby",
        );
      }, MOTION_INTERVAL_MS + 20);
    },
    [sendMotion],
  );

  const announceImmediately = useCallback((text: string) => {
    announcementIdRef.current += 1;
    const next = { id: announcementIdRef.current, text };
    if (announcementTimerRef.current !== null) {
      window.clearTimeout(announcementTimerRef.current);
    }
    // Keep one mounted live region and force a real text mutation even when
    // consecutive events use identical copy.
    setAnnouncement({ id: next.id, text: "" });
    announcementTimerRef.current = window.setTimeout(() => {
      announcementTimerRef.current = null;
      setAnnouncement(next);
    }, 20);
  }, []);

  const setMotionEnabled = useCallback(
    (enabled: boolean) => {
      motionEnabledRef.current = enabled;
      setMotionEnabledState(enabled);
      const stored = storedSessionRef.current;
      if (stored) {
        stored.motionPreference = enabled ? "on" : "off";
        writeStoredSession(stored);
      }
      if (!enabled) {
        disableOutgoingMotion();
      } else if (motionUnlockedRef.current && document.visibilityState === "visible") {
        const activeRoom = roomRef.current;
        sendMotion(
          PARTY_HOUSE_ROOM_ZONES[activeRoom],
          0,
          activeRoom !== "lobby",
          true,
        );
      }
    },
    [disableOutgoingMotion, sendMotion],
  );

  const addBalloon = useCallback((balloon: PartyHouseBalloon) => {
    if (
      visibleBalloonsRef.current.some(
        ({ eventId }) => eventId === balloon.eventId,
      )
    ) {
      return;
    }
    if (visibleBalloonsRef.current.length >= MAX_VISIBLE_BALLOONS) {
      setSwell((value) => value + 1);
      if (selfRef.current?.id !== balloon.lightId) return;
      visibleBalloonsRef.current = visibleBalloonsRef.current.slice(1);
    }
    visibleBalloonsRef.current = [...visibleBalloonsRef.current, balloon];
    setBalloons(visibleBalloonsRef.current);
    const timer = window.setTimeout(() => {
      visibleBalloonsRef.current = visibleBalloonsRef.current.filter(
        ({ eventId }) => eventId !== balloon.eventId,
      );
      setBalloons(visibleBalloonsRef.current);
      balloonTimersRef.current.delete(timer);
    }, BALLOON_LIFETIME_MS);
    balloonTimersRef.current.add(timer);
  }, []);

  const announcePeerEvent = useCallback((text: string) => {
    const now = Date.now();
    const elapsed = now - lastPeerAnnouncementRef.current;
    queuedPeerAnnouncementRef.current = text;
    const announce = () => {
      lastPeerAnnouncementRef.current = Date.now();
      announceImmediately(queuedPeerAnnouncementRef.current);
    };
    if (elapsed >= PEER_ANNOUNCEMENT_INTERVAL_MS) {
      announce();
      return;
    }
    if (peerAnnouncementTimerRef.current !== null) return;
    peerAnnouncementTimerRef.current = window.setTimeout(() => {
      peerAnnouncementTimerRef.current = null;
      announce();
    }, PEER_ANNOUNCEMENT_INTERVAL_MS - elapsed);
  }, [announceImmediately]);

  const handleServerMessage = useCallback(
    (message: PartyHouseServerMessage) => {
      switch (message.type) {
        case "house:welcome": {
          modeRef.current = message.mode;
          selfRef.current = message.self;
          setMode(message.mode);
          setSelf(message.self);
          presenceCountRef.current = message.presenceCount;
          setPresenceCount(message.presenceCount);
          setLights(message.lights);
          setAfterglow(message.afterglow);
          setConnectionState("live");

          const previous = storedSessionRef.current;
          const continuing =
            previous?.generation === message.generation &&
            previous.sessionId === message.sessionId;
          const next: StoredPartyHouseSession = {
            generation: message.generation,
            sessionId: message.sessionId,
            hasLeftBalloon: continuing ? previous.hasLeftBalloon : false,
            motionPreference: continuing ? previous.motionPreference : null,
          };
          storedSessionRef.current = next;
          writeStoredSession(next);
          hasLeftBalloonRef.current = next.hasLeftBalloon;
          setHasLeftBalloon(next.hasLeftBalloon);
          motionUnlockedRef.current = next.hasLeftBalloon;
          motionEnabledRef.current =
            next.hasLeftBalloon && next.motionPreference === "on";
          motionWasSharedRef.current = message.self.sharing;
          setMotionEnabledState(motionEnabledRef.current);
          const effectiveSharing =
            motionUnlockedRef.current &&
            motionEnabledRef.current &&
            roomRef.current !== "lobby" &&
            document.visibilityState === "visible";
          if (message.self.sharing && !effectiveSharing) {
            sendMotion(PARTY_HOUSE_ROOM_ZONES.lobby, 0, false, true);
            motionWasSharedRef.current = false;
          } else if (effectiveSharing) {
            sendMotion(
              PARTY_HOUSE_ROOM_ZONES[roomRef.current],
              0,
              true,
              true,
            );
          }
          return;
        }
        case "house:snapshot": {
          const previousCount = presenceCountRef.current;
          if (previousCount !== null && message.presenceCount > previousCount) {
            announcePeerEvent("Another light joined the house.");
            setSwell((value) => value + 1);
          } else if (
            previousCount !== null &&
            message.presenceCount < previousCount
          ) {
            announcePeerEvent("A light left the house.");
          }
          presenceCountRef.current = message.presenceCount;
          setPresenceCount(message.presenceCount);
          setLights(message.lights);
          setAfterglow(message.afterglow);
          return;
        }
        case "light:move":
          if (selfRef.current?.id === message.lightId) {
            const nextSelf = {
              ...selfRef.current,
              zone: message.zone,
              energy: message.energy,
              sharing: message.sharing,
            };
            selfRef.current = nextSelf;
            setSelf(nextSelf);
          }
          setLights((current) =>
            current.map((light) =>
              light.id === message.lightId
                ? {
                    ...light,
                    zone: message.zone,
                    energy: message.energy,
                    sharing: message.sharing,
                  }
                : light,
            ),
          );
          return;
        case "knock": {
          addBalloon(message);
          const isSelf =
            selfRef.current?.id === message.lightId &&
            pendingBalloonTimersRef.current.has(message.requestId);
          if (isSelf) {
            const pendingTimer = pendingBalloonTimersRef.current.get(
              message.requestId,
            );
            if (pendingTimer !== undefined) window.clearTimeout(pendingTimer);
            pendingBalloonTimersRef.current.delete(message.requestId);
            balloonPendingRef.current = false;
            hasLeftBalloonRef.current = true;
            setBalloonPending(false);
            setHasLeftBalloon(true);
            announceImmediately(
              "Balloon left. Its anonymous color lingers for 24 hours.",
            );
            setBalloonConfirmed(true);
            if (confirmationTimerRef.current !== null) {
              window.clearTimeout(confirmationTimerRef.current);
            }
            confirmationTimerRef.current = window.setTimeout(() => {
              confirmationTimerRef.current = null;
              setBalloonConfirmed(false);
            }, BALLOON_CONFIRMATION_MS);

            if (!motionUnlockedRef.current) {
              motionUnlockedRef.current = true;
            }
            motionEnabledRef.current = true;
            setMotionEnabledState(true);
            const stored = storedSessionRef.current;
            if (stored) {
              stored.hasLeftBalloon = true;
              stored.motionPreference = "on";
              writeStoredSession(stored);
            }
            const activeRoom = roomRef.current;
            sendMotion(
              PARTY_HOUSE_ROOM_ZONES[activeRoom],
              0,
              activeRoom !== "lobby",
              true,
            );
          } else {
            announcePeerEvent(
              "Someone left a balloon. Its color joined the house.",
            );
          }
          return;
        }
        case "error":
        case "pong":
          return;
      }
    },
    [addBalloon, announceImmediately, announcePeerEvent, sendMotion],
  );

  useEffect(() => {
    if (!configured || !hydrated || !eligible) {
      socketRef.current?.close(1000, "Party house is not active here");
      socketRef.current = null;
      modeRef.current = null;
      selfRef.current = null;
      if (hydrated) queueMicrotask(clearHouseView);
      return;
    }

    let disposed = false;
    let reconnectAttempt = 0;
    let reconnectTimer: number | null = null;
    let hiddenTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let helloTimer: number | null = null;
    let terminalState = false;

    storedSessionRef.current = readStoredSession();
    const restored = storedSessionRef.current;
    hasLeftBalloonRef.current = restored?.hasLeftBalloon ?? false;
    setHasLeftBalloon(hasLeftBalloonRef.current);
    motionUnlockedRef.current = restored?.hasLeftBalloon ?? false;
    motionEnabledRef.current =
      restored?.hasLeftBalloon === true && restored.motionPreference === "on";
    setMotionEnabledState(motionEnabledRef.current);

    function clearSocketTimers() {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (helloTimer !== null) window.clearTimeout(helloTimer);
      heartbeatTimer = null;
      helloTimer = null;
    }

    function scheduleReconnect() {
      if (disposed || document.visibilityState !== "visible") return;
      setConnectionState("reconnecting");
      const delay =
        RECONNECT_DELAYS_MS[
          Math.min(reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)
        ];
      reconnectAttempt += 1;
      const jitteredDelay = Math.round(delay * (0.75 + Math.random() * 0.5));
      reconnectTimer = window.setTimeout(connect, jitteredDelay);
    }

    function connect() {
      if (disposed || document.visibilityState !== "visible") return;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      clearSocketTimers();
      setConnectionState(reconnectAttempt === 0 ? "connecting" : "reconnecting");

      let socket: WebSocket;
      try {
        socket = new WebSocket(
          partyHouseRealtimeWebSocketUrl(PARTY_REALTIME_URL),
          partyHouseRealtimeWebSocketProtocols(),
        );
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;
      lastMotionSentRef.current = { key: "", at: 0 };
      motionWasSharedRef.current = false;
      let welcomeReceived = false;
      let terminal = false;

      socket.addEventListener("open", () => {
        if (disposed || socketRef.current !== socket) {
          socket.close(1000, "Stale party connection");
          return;
        }
        const stored = storedSessionRef.current;
        socket.send(
          JSON.stringify({
            type: "house:hello",
            generation: stored?.generation ?? null,
            sessionId: stored?.sessionId ?? null,
          }),
        );
        helloTimer = window.setTimeout(() => {
          if (!welcomeReceived) socket.close(1008, "Welcome timed out");
        }, HELLO_TIMEOUT_MS);
        heartbeatTimer = window.setInterval(() => {
          if (isSocketOpen(socket)) socket.send(JSON.stringify({ type: "ping" }));
        }, HEARTBEAT_MS);
      });

      socket.addEventListener("message", (event) => {
        if (disposed || socketRef.current !== socket) return;
        const message = parsePartyHouseServerMessageJson(event.data);
        if (!message) return;
        if (message.type === "house:welcome") {
          welcomeReceived = true;
          reconnectAttempt = 0;
          if (helloTimer !== null) window.clearTimeout(helloTimer);
          helloTimer = null;
        }
        if (message.type === "error" && message.fatal) {
          terminal =
            message.code === "PARTY_DISABLED" || message.code === "HOUSE_FULL";
          terminalState = terminal;
          if (terminal) clearHouseData();
          setConnectionState(
            message.code === "HOUSE_FULL" ? "full" : terminal ? "off" : "reconnecting",
          );
          if (message.code === "GENERATION_CHANGED") {
            storedSessionRef.current = null;
            writeStoredSession(null);
          }
        }
        handleServerMessage(message);
      });

      socket.addEventListener("close", () => {
        clearSocketTimers();
        const wasCurrent = socketRef.current === socket;
        if (wasCurrent) socketRef.current = null;
        if (!disposed && !terminal && wasCurrent) scheduleReconnect();
      });
      socket.addEventListener("error", () => {
        if (!welcomeReceived && !terminal) setConnectionState("reconnecting");
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
        hiddenTimer = null;
        if (!socketRef.current && !terminalState) connect();
        return;
      }
      disableOutgoingMotion();
      if (hiddenTimer === null) {
        hiddenTimer = window.setTimeout(() => {
          hiddenTimer = null;
          socketRef.current?.close(1000, "Tab hidden");
        }, HIDDEN_RELEASE_MS);
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    connect();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
      clearSocketTimers();
      const socket = socketRef.current;
      socketRef.current = null;
      socket?.close(1000, "Party house provider stopped");
    };
    // The state machine intentionally owns one socket for the full eligible
    // route lifetime. Server messages flow through the stable callback.
  }, [
    configured,
    clearHouseData,
    clearHouseView,
    disableOutgoingMotion,
    eligible,
    handleServerMessage,
    hydrated,
  ]);

  useEffect(
    () => () => {
      balloonTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      pendingBalloonTimersRef.current.forEach((timer) => {
        window.clearTimeout(timer);
      });
      if (confirmationTimerRef.current !== null) {
        window.clearTimeout(confirmationTimerRef.current);
      }
      if (roomMotionTimerRef.current !== null) {
        window.clearTimeout(roomMotionTimerRef.current);
      }
      if (peerAnnouncementTimerRef.current !== null) {
        window.clearTimeout(peerAnnouncementTimerRef.current);
      }
      if (announcementTimerRef.current !== null) {
        window.clearTimeout(announcementTimerRef.current);
      }
    },
    [],
  );

  const leaveBalloon = useCallback(() => {
    const socket = socketRef.current;
    if (
      !isSocketOpen(socket) ||
      modeRef.current !== "live" ||
      balloonPendingRef.current ||
      hasLeftBalloonRef.current
    ) {
      return;
    }
    balloonPendingRef.current = true;
    setBalloonPending(true);
    const requestId = crypto.randomUUID();
    const pendingTimer = window.setTimeout(() => {
      pendingBalloonTimersRef.current.delete(requestId);
      balloonPendingRef.current = false;
      setBalloonPending(false);
      announceImmediately("The balloon did not leave. Try again.");
    }, BALLOON_ACK_TIMEOUT_MS);
    pendingBalloonTimersRef.current.set(requestId, pendingTimer);
    socket.send(
      JSON.stringify({
        type: "knock:send",
        requestId,
        zone: PARTY_HOUSE_ROOM_ZONES[roomRef.current],
      }),
    );
  }, [announceImmediately]);

  const roomCounts = useMemo(() => {
    const counts = { code: 0, writing: 0, games: 0 };
    const cohort = new Map<string, PartyHouseLight>();
    if (self) cohort.set(self.id, self);
    for (const light of lights) cohort.set(light.id, light);
    for (const light of cohort.values()) {
      const lightRoom = partyHouseRoomForLight(light);
      if (lightRoom !== "lobby") counts[lightRoom] += 1;
    }
    return counts;
  }, [lights, self]);

  const balloonAvailable =
    connectionState === "live" &&
    mode === "live" &&
    !hasLeftBalloon &&
    !balloonPending;

  const context = useMemo<PartyHouseContextValue>(
    () => ({
      afterglow,
      balloonAvailable,
      balloonConfirmed,
      balloonPending,
      balloons,
      configured,
      connectionState,
      eligible,
      hasLeftBalloon,
      hydrated,
      leaveBalloon,
      lights,
      mode,
      motionEnabled,
      presenceCount,
      room,
      roomCounts,
      self,
      setRoom,
      setMotionEnabled,
      swell,
    }),
    [
      afterglow,
      balloonAvailable,
      balloonConfirmed,
      balloonPending,
      balloons,
      configured,
      connectionState,
      eligible,
      hasLeftBalloon,
      hydrated,
      leaveBalloon,
      lights,
      mode,
      motionEnabled,
      presenceCount,
      room,
      roomCounts,
      self,
      setRoom,
      setMotionEnabled,
      swell,
    ],
  );

  return (
    <PartyHouseContext.Provider value={context}>
      <Suspense fallback={null}>
        <PathnameObserver onPathname={handlePathname} />
      </Suspense>
      {children}
      {hydrated && eligible && announcement ? (
        <p
          aria-live="polite"
          className="sr-only"
          data-announcement-id={announcement.id}
          role="status"
        >
          {announcement.text}
        </p>
      ) : null}
    </PartyHouseContext.Provider>
  );
}

export function usePartyHouse(): PartyHouseContextValue {
  const context = useContext(PartyHouseContext);
  if (!context) throw new Error("usePartyHouse must be used inside PartyHouseProvider");
  return context;
}

function visibleStatus(
  state: PartyHouseConnectionState,
  count: number | null,
): string {
  if (state === "full") return "HOUSE IS FULL";
  if (state === "reconnecting") return "LIGHTS FLICKERING";
  if (state !== "live" || count === null) return "OPENING…";
  if (count <= 1) return "ROOM OPEN";
  if (count < 10) return `${count} LIGHTS ON`;
  return "HOUSE IS LOUD";
}

export function PartySwitchboard({
  disabled = false,
  surface = "site",
}: {
  disabled?: boolean;
  surface?: "home" | "site";
}) {
  const house = usePartyHouse();
  const latestBalloonId = house.balloons.at(-1)?.eventId ?? "";
  const pulsing = latestBalloonId.length > 0;

  if (
    disabled ||
    !house.configured ||
    house.connectionState === "off" ||
    (house.hydrated && !house.eligible)
  ) {
    return null;
  }

  const status = visibleStatus(
    house.connectionState,
    house.presenceCount,
  );
  const exactStatus =
    house.presenceCount === null
      ? status
      : `${status}. ${house.presenceCount} anonymous ${
          house.presenceCount === 1 ? "light" : "lights"
        } currently on in the shared house.`;
  const serializedAfterglow = JSON.stringify({
    weights: house.afterglow.weights,
    intensity: house.afterglow.intensity,
  });

  return (
    <div
      className={styles.house}
      data-afterglow={serializedAfterglow}
      data-connection={house.connectionState}
      data-party-house=""
      data-presence={house.presenceCount ?? ""}
      data-room={house.room}
      data-testid="party-house"
    >
      <div
        aria-label="Live party status"
        className={styles.switchboard}
        data-afterglow={serializedAfterglow}
        data-balloon-pulse={pulsing ? "true" : "false"}
        data-connection={house.connectionState}
        data-party-surface={surface}
        data-presence={house.presenceCount ?? ""}
        data-testid="party-switchboard"
        role="group"
      >
        <span
          aria-label={exactStatus}
          className={styles.status}
          data-testid="party-status"
        >
          <span aria-hidden="true" className={styles.statusLight} />
          <span>{status}</span>
        </span>
      </div>
    </div>
  );
}
