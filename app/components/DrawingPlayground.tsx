"use client";

import { usePathname } from "next/navigation";
import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
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

const STROKE_WIDTH = 32;
const STROKE_OPACITY = 0.45;
const SAMPLE_DISTANCE = 3;
const IDLE_BREAK_MS = 150;
const CHECKPOINT_INTERVAL_MS = 1_000;
const CLEAR_CONFIRMATION_MS = 5_000;

type Point = {
  x: number;
  y: number;
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
  const [enabled, setEnabled] = useState(false);
  const [color, setColor] = useState<HighlighterColor>(DEFAULT_COLOR);
  const [hydrated, setHydrated] = useState(false);
  const [clearConfirming, setClearConfirming] = useState(false);
  const [notSaving, setNotSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const rootRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const markerRef = useRef<HTMLSpanElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const enabledRef = useRef(false);
  const colorRef = useRef<HighlighterColor>(DEFAULT_COLOR);
  const routeRef = useRef(route);
  const currentStrokesRef = useRef<StrokeRecord[]>([]);
  const memoryStrokesRef = useRef(new Map<string, StrokeRecord[]>());
  const activeStrokeRef = useRef<StrokeRecord | null>(null);
  const activePointerIdRef = useRef<number | null>(null);
  const activeRawPointRef = useRef<Point | null>(null);
  const lastCheckpointRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameRef = useRef<number | null>(null);
  const loadGenerationRef = useRef(0);
  const storageAvailableRef = useRef(true);
  const storageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const mobileNavigationOpenRef = useRef(false);
  const mountedRef = useRef(false);

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

    for (const stroke of currentStrokesRef.current) {
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

    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }, []);

  const scheduleRedraw = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(paintCanvas);
  }, [paintCanvas]);

  const markStorageUnavailable = useCallback(() => {
    storageAvailableRef.current = false;
    if (mountedRef.current) {
      setNotSaving(true);
    }
  }, []);

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
  }, []);

  const finishActiveStroke = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
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

      enqueueStrokeSave(stroke);
      scheduleRedraw();
    }

    activeStrokeRef.current = null;
    activePointerIdRef.current = null;
    activeRawPointRef.current = null;
    lastCheckpointRef.current = 0;
  }, [enqueueStrokeSave, scheduleRedraw]);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current !== null) {
      clearTimeout(idleTimerRef.current);
    }
    idleTimerRef.current = setTimeout(finishActiveStroke, IDLE_BREAK_MS);
  }, [finishActiveStroke]);

  const addDocumentPoint = useCallback(
    (point: Point, pointerId: number) => {
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
        activePointerIdRef.current = pointerId;
        currentStrokesRef.current.push(stroke);
        memoryStrokesRef.current.set(routeRef.current, currentStrokesRef.current);
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
      if (now - lastCheckpointRef.current >= CHECKPOINT_INTERVAL_MS) {
        lastCheckpointRef.current = now;
        enqueueStrokeSave(stroke);
      }

      scheduleRedraw();
    },
    [enqueueStrokeSave, scheduleRedraw],
  );

  const commitPreferences = useCallback(
    (nextEnabled: boolean, nextColor: HighlighterColor) => {
      enabledRef.current = nextEnabled;
      colorRef.current = nextColor;
      setEnabled(nextEnabled);
      setColor(nextColor);
      const preferencesSaved = writePreferences({
        version: 1,
        enabled: nextEnabled,
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
    const preferences = readPreferences();
    enabledRef.current = preferences.enabled;
    colorRef.current = preferences.color;
    // Browser preferences can only be restored after the server-rendered shell
    // hydrates. Synchronizing these two controls here is intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEnabled(preferences.enabled);
    setColor(preferences.color);
    setHydrated(true);
    if (!hasPreferenceStorageAccess()) {
      setNotSaving(true);
    }

    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const loadGeneration = loadGenerationRef.current + 1;
    loadGenerationRef.current = loadGeneration;

    if (routeRef.current !== route) {
      cancelClearConfirmation();
      finishActiveStroke();
      routeRef.current = route;
    }

    const cachedStrokes = memoryStrokesRef.current.get(route);
    currentStrokesRef.current = cachedStrokes ?? [];
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
    markStorageUnavailable,
    route,
    scheduleRedraw,
  ]);

  useEffect(() => {
    function handlePointerMove(event: PointerEvent) {
      if (event.pointerType === "touch") {
        hideMarker();
        return;
      }

      const target = event.target;
      const isOverControls =
        target instanceof Element &&
        target.closest("[data-drawing-control]") !== null;

      if (
        !enabledRef.current ||
        isOverControls ||
        mobileNavigationOpenRef.current
      ) {
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

      for (const pointerEvent of pointerEvents) {
        addDocumentPoint(
          {
            x: pointerEvent.clientX + window.scrollX,
            y: pointerEvent.clientY + window.scrollY,
          },
          event.pointerId,
        );
      }

      resetIdleTimer();

      const marker = markerRef.current;
      if (marker) {
        marker.style.transform = `translate3d(${event.clientX - STROKE_WIDTH / 2}px, ${event.clientY - STROKE_WIDTH / 2}px, 0)`;
        marker.dataset.visible = "true";
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
      }
    }

    function handlePageHide() {
      hideMarker();
      finishActiveStroke();
    }

    function handleViewportChange() {
      scheduleRedraw();
    }

    window.addEventListener("pointermove", handlePointerMove, {
      capture: true,
    });
    window.addEventListener("pointercancel", handlePointerCancel, true);
    window.addEventListener("pointerout", handleWindowExit, true);
    window.addEventListener("blur", handlePageHide);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("scroll", handleViewportChange, { passive: true });
    window.addEventListener("resize", handleViewportChange, { passive: true });
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove, true);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
      window.removeEventListener("pointerout", handleWindowExit, true);
      window.removeEventListener("blur", handlePageHide);
      window.removeEventListener("pagehide", handlePageHide);
      window.removeEventListener("scroll", handleViewportChange);
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
    return () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }
      if (idleTimerRef.current !== null) {
        clearTimeout(idleTimerRef.current);
      }
      if (clearTimerRef.current !== null) {
        clearTimeout(clearTimerRef.current);
      }
    };
  }, []);

  function handleToggle() {
    cancelClearConfirmation();
    const nextEnabled = !enabledRef.current;
    finishActiveStroke();
    if (!nextEnabled) hideMarker();
    commitPreferences(nextEnabled, colorRef.current);
    setStatusMessage(nextEnabled ? "Drawing mode on." : "Drawing mode off.");
  }

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

  const rootStyle = {
    "--drawing-color": color,
  } as CSSProperties;

  return (
    <div
      className="drawing-playground"
      data-enabled={enabled}
      data-hydrated={hydrated}
      data-saving={notSaving ? "memory-only" : "persistent"}
      data-testid="drawing-playground"
      ref={rootRef}
      style={rootStyle}
    >
      <canvas
        aria-hidden="true"
        className="drawing-canvas"
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
          data-visible={enabled}
          id="drawing-tools"
          inert={!enabled ? true : undefined}
        >
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

        <button
          aria-controls="drawing-tools"
          aria-expanded={enabled}
          aria-label={enabled ? "Turn drawing mode off" : "Turn drawing mode on"}
          aria-pressed={enabled}
          className="drawing-toggle"
          data-testid="drawing-toggle"
          onClick={handleToggle}
          type="button"
        >
          <span aria-hidden="true" className="drawing-balloon">
            <span className="drawing-balloon-body" />
            <span className="drawing-balloon-knot" />
            <span className="drawing-balloon-string" />
          </span>
          <span className="sr-only">Drawing highlighter</span>
        </button>
      </div>
    </div>
  );
}
