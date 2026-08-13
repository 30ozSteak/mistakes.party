"use client";

import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  PARTY_SESSION_STORAGE_KEY,
  PARTY_SIGNAL_KINDS,
  PARTY_SIGNAL_LABELS,
  isPartyRoute,
  isPartySessionId,
  normalizePartyRoute,
  parsePartyServerMessageJson,
  partyRealtimeWebSocketProtocols,
  partyRealtimeWebSocketUrl,
  type PartySignalKind,
} from "../lib/partyProtocol";
import { PARTY_REALTIME_URL } from "../lib/partyRealtimeConfig";
import styles from "./PartyPresence.module.css";

type ConnectionState = "connecting" | "live" | "reconnecting";

type SignalEvent = {
  id: string;
  kind: PartySignalKind;
  self: boolean;
};

const HEARTBEAT_MS = 25_000;
const WELCOME_TIMEOUT_MS = 10_000;
const HIDDEN_RELEASE_MS = 30_000;
const SIGNAL_COOLDOWN_MS = 1_000;
const SIGNAL_LIFETIME_MS = 1_800;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 8_000, 15_000];

function subscribeToHydration() {
  return () => {};
}

function getClientHydrationSnapshot() {
  return true;
}

function getServerHydrationSnapshot() {
  return false;
}

function readStoredSessionId(): string | null {
  try {
    const value = window.sessionStorage.getItem(PARTY_SESSION_STORAGE_KEY);
    return isPartySessionId(value) ? value : null;
  } catch {
    return null;
  }
}

function storeSessionId(value: string): void {
  try {
    window.sessionStorage.setItem(PARTY_SESSION_STORAGE_KEY, value);
  } catch {
    // Presence still works when storage is unavailable; reconnects may briefly
    // count as a new session.
  }
}

function clearStoredSessionId(): void {
  try {
    window.sessionStorage.removeItem(PARTY_SESSION_STORAGE_KEY);
  } catch {
    // The next connection can still obtain a fresh server-issued session.
  }
}

export function PartyPresence() {
  const pathname = usePathname();
  const route = useMemo(() => normalizePartyRoute(pathname), [pathname]);
  const available =
    PARTY_REALTIME_URL.length > 0 &&
    pathname.length <= 256 &&
    isPartyRoute(route);
  const hydrated = useSyncExternalStore(
    subscribeToHydration,
    getClientHydrationSnapshot,
    getServerHydrationSnapshot,
  );
  const [fatal, setFatal] = useState(false);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("connecting");
  const [presenceCount, setPresenceCount] = useState<number | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [signals, setSignals] = useState<SignalEvent[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const [coolingDown, setCoolingDown] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const firstSignalRef = useRef<HTMLButtonElement>(null);
  const seenSignalIdsRef = useRef(new Set<string>());
  const pendingSelfSignalsRef = useRef<
    Array<{ key: number; kind: PartySignalKind }>
  >([]);
  const pendingSignalKeyRef = useRef(0);
  const signalTimersRef = useRef(new Set<number>());
  const cooldownTimerRef = useRef<number | null>(null);

  const showSignal = useCallback((id: string, kind: PartySignalKind) => {
    if (seenSignalIdsRef.current.has(id)) return;
    if (seenSignalIdsRef.current.size >= 128) {
      const oldestId = seenSignalIdsRef.current.values().next().value;
      if (oldestId) seenSignalIdsRef.current.delete(oldestId);
    }
    seenSignalIdsRef.current.add(id);

    const pendingIndex = pendingSelfSignalsRef.current.findIndex(
      (pending) => pending.kind === kind,
    );
    const self = pendingIndex >= 0;
    if (self) pendingSelfSignalsRef.current.splice(pendingIndex, 1);
    if (self) setAnnouncement(`Sent ${PARTY_SIGNAL_LABELS[kind]}.`);

    setSignals((current) => [...current.slice(-7), { id, kind, self }]);
    const timer = window.setTimeout(() => {
      signalTimersRef.current.delete(timer);
      setSignals((current) => current.filter((signal) => signal.id !== id));
    }, SIGNAL_LIFETIME_MS);
    signalTimersRef.current.add(timer);
  }, []);

  useEffect(() => {
    const signalTimers = signalTimersRef.current;
    return () => {
      for (const timer of signalTimers) window.clearTimeout(timer);
      if (cooldownTimerRef.current !== null) {
        window.clearTimeout(cooldownTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!available) return;

    let stopped = false;
    let fatallyClosed = false;
    let welcomed = false;
    let attempt = 0;
    let reconnectTimer: number | null = null;
    let heartbeatTimer: number | null = null;
    let welcomeTimer: number | null = null;
    let hiddenTimer: number | null = null;
    let sessionId = readStoredSessionId();

    queueMicrotask(() => {
      if (stopped) return;
      setFatal(false);
      setPresenceCount(null);
      setConnectionState("connecting");
      setSignals([]);
      setAnnouncement("");
      pendingSelfSignalsRef.current = [];
      seenSignalIdsRef.current.clear();
    });

    function clearSocketTimers() {
      if (heartbeatTimer !== null) window.clearInterval(heartbeatTimer);
      if (welcomeTimer !== null) window.clearTimeout(welcomeTimer);
      heartbeatTimer = null;
      welcomeTimer = null;
    }

    function closeSocket(reason: string) {
      const socket = socketRef.current;
      socketRef.current = null;
      clearSocketTimers();
      if (
        socket &&
        (socket.readyState === WebSocket.OPEN ||
          socket.readyState === WebSocket.CONNECTING)
      ) {
        try {
          socket.close(1000, reason);
        } catch {
          // Some browsers throw when a connecting socket is closed.
        }
      }
    }

    function scheduleReconnect() {
      if (
        stopped ||
        fatallyClosed ||
        reconnectTimer !== null ||
        document.visibilityState === "hidden" ||
        !navigator.onLine
      ) {
        return;
      }

      setConnectionState(welcomed ? "reconnecting" : "connecting");
      const baseDelay =
        RECONNECT_DELAYS_MS[
          Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)
        ];
      attempt += 1;
      const delay = Math.round(baseDelay * (0.75 + Math.random() * 0.5));
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    }

    function connect() {
      if (
        stopped ||
        fatallyClosed ||
        socketRef.current !== null ||
        document.visibilityState === "hidden" ||
        !navigator.onLine
      ) {
        return;
      }

      setConnectionState(welcomed ? "reconnecting" : "connecting");
      let socket: WebSocket;
      try {
        socket = new WebSocket(
          partyRealtimeWebSocketUrl(PARTY_REALTIME_URL, route, sessionId),
          partyRealtimeWebSocketProtocols(),
        );
      } catch {
        scheduleReconnect();
        return;
      }
      socketRef.current = socket;

      socket.addEventListener("open", () => {
        if (stopped || socketRef.current !== socket) return;
        welcomeTimer = window.setTimeout(() => {
          if (stopped || socketRef.current !== socket) return;
          closeSocket("Welcome timed out");
          scheduleReconnect();
        }, WELCOME_TIMEOUT_MS);
        heartbeatTimer = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send('{"type":"ping"}');
          }
        }, HEARTBEAT_MS);
      });

      socket.addEventListener("message", (event) => {
        if (stopped || socketRef.current !== socket) return;
        const message = parsePartyServerMessageJson(event.data);
        if (!message) return;

        switch (message.type) {
          case "welcome":
            if (message.route !== route) {
              fatallyClosed = true;
              setFatal(true);
              closeSocket("Route mismatch");
              return;
            }
            welcomed = true;
            attempt = 0;
            if (welcomeTimer !== null) window.clearTimeout(welcomeTimer);
            welcomeTimer = null;
            sessionId = message.sessionId;
            storeSessionId(message.sessionId);
            setPresenceCount(message.presenceCount);
            setConnectionState("live");
            return;
          case "presence":
            if (welcomed) setPresenceCount(message.presenceCount);
            return;
          case "signal":
            if (welcomed) showSignal(message.id, message.kind);
            return;
          case "error":
            setAnnouncement(message.message);
            if (message.fatal) {
              if (message.code === "PARTY_DISABLED") {
                fatallyClosed = true;
                setFatal(true);
                closeSocket("Party unavailable");
              } else if (message.code === "GENERATION_CHANGED") {
                sessionId = null;
                clearStoredSessionId();
                closeSocket("Party generation changed");
                scheduleReconnect();
              } else {
                closeSocket("Party connection reset");
                scheduleReconnect();
              }
            } else if (message.retryAfterMs !== undefined) {
              pendingSelfSignalsRef.current = [];
              setCoolingDown(true);
              if (cooldownTimerRef.current !== null) {
                window.clearTimeout(cooldownTimerRef.current);
              }
              cooldownTimerRef.current = window.setTimeout(() => {
                cooldownTimerRef.current = null;
                setCoolingDown(false);
              }, message.retryAfterMs);
            }
            return;
          case "pong":
            return;
        }
      });

      socket.addEventListener("close", () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        clearSocketTimers();
        scheduleReconnect();
      });

      socket.addEventListener("error", () => {
        // The close event owns reconnect scheduling. Browsers intentionally do
        // not expose detailed WebSocket errors.
      });
    }

    function releaseWhileHidden() {
      hiddenTimer = null;
      closeSocket("Page hidden");
    }

    function handleVisibilityChange() {
      if (document.visibilityState === "hidden") {
        if (hiddenTimer === null) {
          hiddenTimer = window.setTimeout(releaseWhileHidden, HIDDEN_RELEASE_MS);
        }
        return;
      }

      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
      hiddenTimer = null;
      connect();
    }

    function handleOnline() {
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      reconnectTimer = null;
      connect();
    }

    function handleOffline() {
      setConnectionState(welcomed ? "reconnecting" : "connecting");
      closeSocket("Browser offline");
    }

    function handlePageHide() {
      closeSocket("Page closed");
    }

    function handlePageShow() {
      connect();
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    connect();

    return () => {
      stopped = true;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (hiddenTimer !== null) window.clearTimeout(hiddenTimer);
      closeSocket("Route changed");
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [available, route, showSignal]);

  useEffect(() => {
    if (available && !fatal) return;
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else queueMicrotask(() => setDialogOpen(false));
  }, [available, fatal]);

  useEffect(() => {
    if (dialogOpen && connectionState === "live") {
      firstSignalRef.current?.focus();
    } else if (
      dialogOpen &&
      document.activeElement instanceof HTMLButtonElement &&
      document.activeElement.disabled
    ) {
      dialogRef.current?.focus();
    }
  }, [connectionState, dialogOpen]);

  const closeDialog = useCallback(() => {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else setDialogOpen(false);
  }, []);

  function handleDialogClosed() {
    setDialogOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  function openDialog() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setDialogOpen(true);
    window.requestAnimationFrame(() => {
      if (connectionState === "live") firstSignalRef.current?.focus();
      else dialog.focus();
    });
  }

  function sendSignal(kind: PartySignalKind) {
    const socket = socketRef.current;
    if (
      connectionState !== "live" ||
      coolingDown ||
      !socket ||
      socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    socket.send(JSON.stringify({ type: "signal:send", kind }));
    pendingSignalKeyRef.current += 1;
    const pendingKey = pendingSignalKeyRef.current;
    pendingSelfSignalsRef.current.push({ key: pendingKey, kind });
    const pendingTimer = window.setTimeout(() => {
      signalTimersRef.current.delete(pendingTimer);
      pendingSelfSignalsRef.current = pendingSelfSignalsRef.current.filter(
        (pending) => pending.key !== pendingKey,
      );
    }, 5_000);
    signalTimersRef.current.add(pendingTimer);
    setAnnouncement("");
    setCoolingDown(true);
    if (cooldownTimerRef.current !== null) {
      window.clearTimeout(cooldownTimerRef.current);
    }
    cooldownTimerRef.current = window.setTimeout(() => {
      cooldownTimerRef.current = null;
      setCoolingDown(false);
    }, SIGNAL_COOLDOWN_MS);
    closeDialog();
  }

  if (!available || fatal) return null;

  const shownCount =
    presenceCount === null
      ? "X"
      : presenceCount > 99
        ? "99+"
        : String(presenceCount);
  const triggerLabel =
    presenceCount === null
      ? "Party presence is connecting. Send a party signal."
      : `${presenceCount} ${presenceCount === 1 ? "visitor" : "visitors"} here. Send a party signal.`;
  const signalsDisabled = connectionState !== "live" || coolingDown;

  return (
    <aside
      className={styles.root}
      data-connection={connectionState}
      data-hydrated={hydrated}
      data-party-presence
      data-testid="party-presence"
    >
      <div aria-hidden="true" className={styles.signalLayer}>
        {signals.map((signal) => (
          <span
            className={styles.signalEvent}
            data-kind={signal.kind}
            data-self={signal.self}
            data-testid="party-signal-event"
            key={signal.id}
          >
            {PARTY_SIGNAL_LABELS[signal.kind]}
          </span>
        ))}
      </div>

      <button
        aria-controls="party-signal-sheet"
        aria-expanded={dialogOpen}
        aria-haspopup="dialog"
        aria-label={triggerLabel}
        className={styles.trigger}
        data-testid="party-trigger"
        onClick={openDialog}
        ref={triggerRef}
        type="button"
      >
        {shownCount} HERE
      </button>

      <dialog
        aria-labelledby="party-dialog-title"
        className={styles.dialog}
        data-testid="party-dialog"
        id="party-signal-sheet"
        onClick={(event) => {
          if (event.target === event.currentTarget) closeDialog();
        }}
        onClose={handleDialogClosed}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className={styles.sheet}>
          <button
            aria-label="Close party signals"
            className={styles.close}
            data-testid="party-dialog-close"
            onClick={closeDialog}
            type="button"
          >
            ×
          </button>
          <p className={styles.eyebrow}>{shownCount} HERE</p>
          <h2 id="party-dialog-title">SEND A SIGNAL</h2>
          <p className={styles.explanation}>PICK ONE. IT DISAPPEARS.</p>
          {connectionState !== "live" ? (
            <p
              aria-live="polite"
              className={styles.connection}
              role="status"
            >
              RECONNECTING…
            </p>
          ) : null}
          <div className={styles.signalGrid}>
            {PARTY_SIGNAL_KINDS.map((kind, index) => (
              <button
                className={styles.signalButton}
                data-kind={kind}
                data-testid={`party-signal-${kind}`}
                disabled={signalsDisabled}
                key={kind}
                onClick={() => sendSignal(kind)}
                ref={index === 0 ? firstSignalRef : undefined}
                type="button"
              >
                {PARTY_SIGNAL_LABELS[kind]}
              </button>
            ))}
          </div>
        </div>
      </dialog>

      <p aria-live="polite" className="sr-only" role="status">
        {announcement}
      </p>
    </aside>
  );
}
