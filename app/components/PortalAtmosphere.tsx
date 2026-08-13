"use client";

import { useEffect, useRef } from "react";

const POINTER_RANGE_X = 28;
const POINTER_RANGE_Y = 18;
const POINTER_TURN = 5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function PortalAtmosphere() {
  const atmosphereRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const atmosphere = atmosphereRef.current;
    if (!atmosphere) return;
    const atmosphereStyle = atmosphere.style;

    const finePointer = window.matchMedia(
      "(hover: hover) and (pointer: fine)",
    );
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    );
    let animationFrame: number | null = null;
    let nextX = 0;
    let nextY = 0;
    let nextTurn = 0;

    function writePosition() {
      animationFrame = null;
      atmosphereStyle.setProperty("--portal-pointer-x", `${nextX}px`);
      atmosphereStyle.setProperty("--portal-pointer-y", `${nextY}px`);
      atmosphereStyle.setProperty(
        "--portal-pointer-turn",
        `${nextTurn}deg`,
      );
    }

    function schedulePosition() {
      if (animationFrame === null) {
        animationFrame = window.requestAnimationFrame(writePosition);
      }
    }

    function resetPosition() {
      nextX = 0;
      nextY = 0;
      nextTurn = 0;
      schedulePosition();
    }

    function handlePointerMove(event: PointerEvent) {
      if (
        reducedMotion.matches ||
        !finePointer.matches ||
        event.pointerType === "touch"
      ) {
        return;
      }

      const horizontal = clamp(
        (event.clientX / Math.max(window.innerWidth, 1) - 0.5) * 2,
        -1,
        1,
      );
      const vertical = clamp(
        (event.clientY / Math.max(window.innerHeight, 1) - 0.5) * 2,
        -1,
        1,
      );

      nextX = Number((horizontal * POINTER_RANGE_X).toFixed(2));
      nextY = Number((vertical * POINTER_RANGE_Y).toFixed(2));
      nextTurn = Number(
        ((horizontal - vertical * 0.45) * POINTER_TURN).toFixed(2),
      );
      schedulePosition();
    }

    function handleCapabilityChange() {
      if (reducedMotion.matches || !finePointer.matches) resetPosition();
    }

    function handleVisibilityChange() {
      if (document.visibilityState !== "visible") resetPosition();
    }

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });
    window.addEventListener("blur", resetPosition);
    window.addEventListener("resize", resetPosition, { passive: true });
    document.documentElement.addEventListener("pointerleave", resetPosition);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    finePointer.addEventListener("change", handleCapabilityChange);
    reducedMotion.addEventListener("change", handleCapabilityChange);

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", resetPosition);
      window.removeEventListener("resize", resetPosition);
      document.documentElement.removeEventListener(
        "pointerleave",
        resetPosition,
      );
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      finePointer.removeEventListener("change", handleCapabilityChange);
      reducedMotion.removeEventListener("change", handleCapabilityChange);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="portal-atmosphere"
      data-testid="portal-atmosphere"
      ref={atmosphereRef}
    >
      <div className="portal-atmosphere-field" />
      <div className="portal-atmosphere-glass" />
    </div>
  );
}
