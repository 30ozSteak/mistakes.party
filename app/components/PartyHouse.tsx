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
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  PARTY_HOUSE_AFTERGLOW_WINDOW_MS,
  PARTY_HOUSE_SESSION_STORAGE_KEY,
  isPartyHouseGeneration,
  isPartyHouseSessionId,
  parsePartyHouseServerMessageJson,
  partyHouseRealtimeWebSocketProtocols,
  partyHouseRealtimeWebSocketUrl,
  type PartyHouseAfterglow,
  type PartyHouseEnergy,
  type PartyHouseLight,
  type PartyHouseMode,
  type PartyHouseServerMessage,
  type PartyHouseZone,
} from "../lib/partyHouseProtocol";
import { PARTY_REALTIME_URL } from "../lib/partyRealtimeConfig";
import styles from "./PartyHouse.module.css";

const HEARTBEAT_MS = 25_000;
const HELLO_TIMEOUT_MS = 10_000;
const HIDDEN_RELEASE_MS = 30_000;
const KNOCK_COOLDOWN_MS = 4_000;
const KNOCK_LIFETIME_MS = 900;
const PEER_ANNOUNCEMENT_INTERVAL_MS = 5_000;
const MOTION_INTERVAL_MS = 500;
const MOTION_IDLE_MS = 900;
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

export type PartyHouseKnock = Extract<
  PartyHouseServerMessage,
  { type: "knock" }
>;

type StoredPartyHouseSession = {
  generation: string;
  sessionId: string;
  hasKnocked: boolean;
  motionPreference: "on" | "off" | null;
};

type PartyHouseContextValue = {
  afterglow: PartyHouseAfterglow;
  configured: boolean;
  connectionState: PartyHouseConnectionState;
  eligible: boolean;
  feedback: string | null;
  hydrated: boolean;
  knock: (fromCenter?: boolean) => void;
  knockAvailable: boolean;
  knocks: PartyHouseKnock[];
  lights: PartyHouseLight[];
  mode: PartyHouseMode | null;
  motionCapable: boolean;
  motionEnabled: boolean;
  motionUnlocked: boolean;
  presenceCount: number | null;
  self: PartyHouseLight | null;
  setMotionEnabled: (enabled: boolean) => void;
  swell: number;
  systemReducedMotion: boolean;
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
      typeof record.hasKnocked !== "boolean" ||
      (record.motionPreference !== null &&
        record.motionPreference !== "on" &&
        record.motionPreference !== "off")
    ) {
      return null;
    }
    return {
      generation: record.generation,
      sessionId: record.sessionId,
      hasKnocked: record.hasKnocked,
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

function pointerZone(clientX: number, clientY: number): PartyHouseZone {
  const column = Math.min(
    2,
    Math.max(0, Math.floor((clientX / Math.max(window.innerWidth, 1)) * 3)),
  );
  const row = Math.min(
    2,
    Math.max(0, Math.floor((clientY / Math.max(window.innerHeight, 1)) * 3)),
  );
  return (row * 3 + column) as PartyHouseZone;
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
  const [knocks, setKnocks] = useState<PartyHouseKnock[]>([]);
  const [swell, setSwell] = useState(0);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState<{
    id: number;
    text: string;
  } | null>(null);
  const [motionUnlocked, setMotionUnlocked] = useState(false);
  const [motionEnabled, setMotionEnabledState] = useState(false);
  const [motionCapable, setMotionCapable] = useState(false);
  const [systemReducedMotion, setSystemReducedMotion] = useState(false);
  const [knockAvailable, setKnockAvailable] = useState(true);

  const socketRef = useRef<WebSocket | null>(null);
  const modeRef = useRef<PartyHouseMode | null>(null);
  const selfRef = useRef<PartyHouseLight | null>(null);
  const storedSessionRef = useRef<StoredPartyHouseSession | null>(null);
  const pendingKnocksRef = useRef(new Set<string>());
  const pendingKnockTimersRef = useRef(new Set<number>());
  const knockTimersRef = useRef(new Set<number>());
  const visibleKnocksRef = useRef<PartyHouseKnock[]>([]);
  const feedbackTimerRef = useRef<number | null>(null);
  const knockCooldownTimerRef = useRef<number | null>(null);
  const lastKnockSentAtRef = useRef(0);
  const peerAnnouncementTimerRef = useRef<number | null>(null);
  const queuedPeerAnnouncementRef = useRef("Someone changed the house.");
  const lastPeerAnnouncementRef = useRef(0);
  const announcementIdRef = useRef(0);
  const presenceCountRef = useRef<number | null>(null);

  const clearHouseData = useCallback(() => {
    modeRef.current = null;
    selfRef.current = null;
    presenceCountRef.current = null;
    visibleKnocksRef.current = [];
    setMode(null);
    setSelf(null);
    setLights([]);
    setKnocks([]);
    setPresenceCount(null);
    setAfterglow(EMPTY_AFTERGLOW);
    setSwell(0);
    setFeedback(null);
  }, []);
  const clearHouseView = useCallback(() => {
    clearHouseData();
    setConnectionState("idle");
  }, [clearHouseData]);
  const motionEnabledRef = useRef(false);
  const motionUnlockedRef = useRef(false);
  const reducedMotionRef = useRef(false);
  const finePointerRef = useRef(false);
  const lastZoneRef = useRef<PartyHouseZone>(4);
  const lastPointerRef = useRef({ x: 0, y: 0, at: 0 });
  const lastMotionSentRef = useRef({ key: "", at: 0 });
  const motionWasSharedRef = useRef(false);
  const idleMotionTimerRef = useRef<number | null>(null);
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
          !finePointerRef.current ||
          reducedMotionRef.current ||
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

  const clearIdleMotionTimer = useCallback(() => {
    if (idleMotionTimerRef.current !== null) {
      window.clearTimeout(idleMotionTimerRef.current);
      idleMotionTimerRef.current = null;
    }
  }, []);

  const disableOutgoingMotion = useCallback(() => {
    clearIdleMotionTimer();
    if (!motionUnlockedRef.current || !motionWasSharedRef.current) return;
    sendMotion(4, 0, false, true);
    lastMotionSentRef.current = { key: "", at: 0 };
    motionWasSharedRef.current = false;
  }, [clearIdleMotionTimer, sendMotion]);

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
      } else if (
        motionUnlockedRef.current &&
        finePointerRef.current &&
        !reducedMotionRef.current &&
        document.visibilityState === "visible"
      ) {
        sendMotion(lastZoneRef.current, 0, true, true);
      }
    },
    [disableOutgoingMotion, sendMotion],
  );

  const addKnock = useCallback((knock: PartyHouseKnock) => {
    if (
      visibleKnocksRef.current.some(
        ({ eventId }) => eventId === knock.eventId,
      )
    ) {
      return;
    }
    if (visibleKnocksRef.current.length >= 3) {
      setSwell((value) => value + 1);
      return;
    }
    visibleKnocksRef.current = [...visibleKnocksRef.current, knock];
    setKnocks(visibleKnocksRef.current);
    const timer = window.setTimeout(() => {
      visibleKnocksRef.current = visibleKnocksRef.current.filter(
        ({ eventId }) => eventId !== knock.eventId,
      );
      setKnocks(visibleKnocksRef.current);
      knockTimersRef.current.delete(timer);
    }, KNOCK_LIFETIME_MS);
    knockTimersRef.current.add(timer);
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
            hasKnocked: continuing ? previous.hasKnocked : false,
            motionPreference: continuing ? previous.motionPreference : null,
          };
          storedSessionRef.current = next;
          writeStoredSession(next);
          motionUnlockedRef.current = next.hasKnocked;
          motionEnabledRef.current =
            next.hasKnocked && next.motionPreference === "on";
          motionWasSharedRef.current = message.self.sharing;
          setMotionUnlocked(next.hasKnocked);
          setMotionEnabledState(motionEnabledRef.current);
          const effectiveSharing =
            motionUnlockedRef.current &&
            motionEnabledRef.current &&
            finePointerRef.current &&
            !reducedMotionRef.current &&
            document.visibilityState === "visible";
          if (message.self.sharing && !effectiveSharing) {
            sendMotion(4, 0, false, true);
            motionWasSharedRef.current = false;
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
          addKnock(message);
          const isSelf =
            selfRef.current?.id === message.lightId &&
            pendingKnocksRef.current.delete(message.requestId);
          if (isSelf) {
            announceImmediately("The house heard you. You changed the light.");
            setFeedback("YOU CHANGED THE LIGHT");
            if (feedbackTimerRef.current !== null) {
              window.clearTimeout(feedbackTimerRef.current);
            }
            feedbackTimerRef.current = window.setTimeout(() => {
              feedbackTimerRef.current = null;
              setFeedback(null);
            }, 1_800);

            if (!motionUnlockedRef.current) {
              motionUnlockedRef.current = true;
              setMotionUnlocked(true);
              const stored = storedSessionRef.current;
              if (stored) {
                stored.hasKnocked = true;
                if (stored.motionPreference === null) {
                  const defaultOn = finePointerRef.current;
                  stored.motionPreference = defaultOn ? "on" : "off";
                  motionEnabledRef.current = defaultOn;
                  setMotionEnabledState(defaultOn);
                  if (defaultOn && !reducedMotionRef.current) {
                    sendMotion(lastZoneRef.current, 0, true, true);
                  }
                }
                writeStoredSession(stored);
              }
            }
          } else {
            announcePeerEvent("Someone knocked. The house changed color.");
          }
          return;
        }
        case "error":
        case "pong":
          return;
      }
    },
    [addKnock, announceImmediately, announcePeerEvent, sendMotion],
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
    motionUnlockedRef.current = restored?.hasKnocked ?? false;
    motionEnabledRef.current =
      restored?.hasKnocked === true && restored.motionPreference === "on";
    setMotionUnlocked(motionUnlockedRef.current);
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

  useEffect(() => {
    if (!hydrated || !eligible) return;
    const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    finePointerRef.current = finePointer.matches;
    reducedMotionRef.current = reducedMotion.matches;
    queueMicrotask(() => setMotionCapable(finePointer.matches));
    queueMicrotask(() => setSystemReducedMotion(reducedMotion.matches));

    function stopMotion() {
      clearIdleMotionTimer();
      disableOutgoingMotion();
    }

    function handleCapabilityChange() {
      finePointerRef.current = finePointer.matches;
      reducedMotionRef.current = reducedMotion.matches;
      setMotionCapable(finePointer.matches);
      setSystemReducedMotion(reducedMotion.matches);
      if (!finePointer.matches || reducedMotion.matches) stopMotion();
    }

    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType === "touch") return;
      const now = performance.now();
      const zone = pointerZone(event.clientX, event.clientY);
      lastZoneRef.current = zone;
      const previous = lastPointerRef.current;
      const elapsed = Math.max(1, now - previous.at);
      const distance = Math.hypot(event.clientX - previous.x, event.clientY - previous.y);
      const energy: PartyHouseEnergy =
        previous.at === 0 ? 1 : distance / elapsed > 1.15 ? 2 : 1;
      lastPointerRef.current = { x: event.clientX, y: event.clientY, at: now };

      if (
        !motionUnlockedRef.current ||
        !motionEnabledRef.current ||
        !finePointerRef.current ||
        reducedMotionRef.current ||
        document.visibilityState !== "visible"
      ) {
        return;
      }
      sendMotion(zone, energy, true);
      if (idleMotionTimerRef.current !== null) {
        window.clearTimeout(idleMotionTimerRef.current);
      }
      idleMotionTimerRef.current = window.setTimeout(() => {
        idleMotionTimerRef.current = null;
        if (
          !motionUnlockedRef.current ||
          !motionEnabledRef.current ||
          !finePointerRef.current ||
          reducedMotionRef.current ||
          document.visibilityState !== "visible"
        ) {
          return;
        }
        sendMotion(lastZoneRef.current, 0, true, true);
      }, MOTION_IDLE_MS);
    }

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    finePointer.addEventListener("change", handleCapabilityChange);
    reducedMotion.addEventListener("change", handleCapabilityChange);
    return () => {
      stopMotion();
      window.removeEventListener("pointermove", handlePointerMove);
      finePointer.removeEventListener("change", handleCapabilityChange);
      reducedMotion.removeEventListener("change", handleCapabilityChange);
    };
  }, [
    clearIdleMotionTimer,
    disableOutgoingMotion,
    eligible,
    hydrated,
    sendMotion,
  ]);

  useEffect(
    () => () => {
      knockTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      pendingKnockTimersRef.current.forEach((timer) =>
        window.clearTimeout(timer),
      );
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
      if (peerAnnouncementTimerRef.current !== null) {
        window.clearTimeout(peerAnnouncementTimerRef.current);
      }
      if (announcementTimerRef.current !== null) {
        window.clearTimeout(announcementTimerRef.current);
      }
      if (idleMotionTimerRef.current !== null) {
        window.clearTimeout(idleMotionTimerRef.current);
      }
      if (knockCooldownTimerRef.current !== null) {
        window.clearTimeout(knockCooldownTimerRef.current);
      }
    },
    [],
  );

  const knock = useCallback((fromCenter = false) => {
    const socket = socketRef.current;
    if (!isSocketOpen(socket) || modeRef.current !== "live") return;
    const now = Date.now();
    const remaining =
      KNOCK_COOLDOWN_MS - (now - lastKnockSentAtRef.current);
    if (remaining > 0) return;
    lastKnockSentAtRef.current = now;
    setKnockAvailable(false);
    if (knockCooldownTimerRef.current !== null) {
      window.clearTimeout(knockCooldownTimerRef.current);
    }
    knockCooldownTimerRef.current = window.setTimeout(() => {
      knockCooldownTimerRef.current = null;
      setKnockAvailable(true);
    }, KNOCK_COOLDOWN_MS);
    const requestId = crypto.randomUUID();
    pendingKnocksRef.current.add(requestId);
    const pendingTimer = window.setTimeout(() => {
      pendingKnocksRef.current.delete(requestId);
      pendingKnockTimersRef.current.delete(pendingTimer);
    },
      KNOCK_COOLDOWN_MS * 2,
    );
    pendingKnockTimersRef.current.add(pendingTimer);
    socket.send(
      JSON.stringify({
        type: "knock:send",
        requestId,
        zone: fromCenter ? 4 : lastZoneRef.current,
      }),
    );
  }, []);

  const context = useMemo<PartyHouseContextValue>(
    () => ({
      afterglow,
      configured,
      connectionState,
      eligible,
      feedback,
      hydrated,
      knock,
      knockAvailable,
      knocks,
      lights,
      mode,
      motionCapable,
      motionEnabled,
      motionUnlocked,
      presenceCount,
      self,
      setMotionEnabled,
      swell,
      systemReducedMotion,
    }),
    [
      afterglow,
      configured,
      connectionState,
      eligible,
      feedback,
      hydrated,
      knock,
      knockAvailable,
      knocks,
      lights,
      mode,
      motionCapable,
      motionEnabled,
      motionUnlocked,
      presenceCount,
      self,
      setMotionEnabled,
      swell,
      systemReducedMotion,
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
  feedback: string | null,
): string {
  if (feedback) return feedback;
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
  const latestKnockId = house.knocks.at(-1)?.eventId ?? "";
  const pulsing = latestKnockId.length > 0;

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
    house.feedback,
  );
  const exactStatus =
    house.presenceCount === null
      ? status
      : `${status}. ${house.presenceCount} anonymous ${
          house.presenceCount === 1 ? "light" : "lights"
        } currently on in the shared house.`;
  const interactive =
    house.connectionState === "live" && house.mode === "live";
  const effectiveMotion =
    house.motionEnabled &&
    house.motionCapable &&
    !house.systemReducedMotion;
  const serializedAfterglow = JSON.stringify({
    weights: house.afterglow.weights,
    intensity: house.afterglow.intensity,
  });

  function handleKnock(event: ReactMouseEvent<HTMLButtonElement>) {
    const nativeEvent = event.nativeEvent;
    house.knock(
      event.detail === 0 ||
        ("pointerType" in nativeEvent && nativeEvent.pointerType !== "mouse"),
    );
  }

  return (
    <div
      className={styles.house}
      data-afterglow={serializedAfterglow}
      data-connection={house.connectionState}
      data-party-house=""
      data-presence={house.presenceCount ?? ""}
      data-testid="party-house"
    >
      <div
        aria-label="Live party controls"
        className={styles.switchboard}
        data-afterglow={serializedAfterglow}
        data-connection={house.connectionState}
        data-knock-pulse={pulsing ? "true" : "false"}
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
        {interactive ? (
          <button
            className={styles.action}
            data-testid="party-knock"
            disabled={!house.knockAvailable}
            onClick={handleKnock}
            type="button"
          >
            KNOCK
          </button>
        ) : null}
        {interactive && house.motionUnlocked ? (
          <button
            aria-label={`Coarse shared motion ${
              effectiveMotion ? "on" : "off"
            }. Shares only a three by three page zone.`}
            aria-pressed={effectiveMotion}
            className={styles.motion}
            data-testid="party-motion"
            disabled={!house.motionCapable || house.systemReducedMotion}
            onClick={() => house.setMotionEnabled(!house.motionEnabled)}
            type="button"
          >
            MOTION {effectiveMotion ? "ON" : "OFF"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
