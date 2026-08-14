"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PartyHouseLight } from "../lib/partyHouseProtocol";
import { usePartyHouse } from "./PartyHouse";

const POINTER_RANGE_X = 24;
const POINTER_RANGE_Y = 16;
const POINTER_TURN = 6;
const LIGHT_DEPARTURE_MS = 400;
const PARTY_COLOR_COUNT = 4;

type VisualLight = PartyHouseLight & { leaving: boolean };

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function activeColorWeights(lights: PartyHouseLight[]): number[] {
  const weights = Array<number>(PARTY_COLOR_COUNT).fill(0);
  if (lights.length === 0) return weights;
  for (const light of lights) weights[light.color] += 1 / lights.length;
  return weights;
}

function crowdLevel(presenceCount: number | null): number {
  if (presenceCount === null || presenceCount <= 1) return 0;
  if (presenceCount === 2) return 1;
  if (presenceCount <= 4) return 2;
  if (presenceCount <= 8) return 3;
  return 4;
}

function visualCohort(
  self: PartyHouseLight | null,
  lights: PartyHouseLight[],
): PartyHouseLight[] {
  const cohort = new Map<string, PartyHouseLight>();
  if (self) cohort.set(self.id, self);
  for (const light of lights) {
    if (!cohort.has(light.id)) cohort.set(light.id, light);
  }
  return [...cohort.values()].slice(0, 12);
}

export function PortalAtmosphere() {
  const house = usePartyHouse();
  const atmosphereRef = useRef<HTMLDivElement>(null);
  const visualLightsRef = useRef<VisualLight[]>([]);
  const departureTimersRef = useRef(new Map<string, number>());
  const [visualLights, setVisualLights] = useState<VisualLight[]>([]);
  const desiredLights = useMemo(
    () =>
      house.connectionState === "live"
        ? visualCohort(house.self, house.lights)
        : [],
    [house.connectionState, house.lights, house.self],
  );
  const activeWeights = useMemo(
    () => activeColorWeights(desiredLights),
    [desiredLights],
  );
  const presenceStrength = clamp(
    ((house.presenceCount ?? 1) - 1) / 3,
    0,
    1,
  );

  useEffect(() => {
    const desiredIds = new Set(desiredLights.map(({ id }) => id));
    const currentById = new Map(
      visualLightsRef.current.map((light) => [light.id, light]),
    );
    const next: VisualLight[] = desiredLights.map((light) => {
      const timer = departureTimersRef.current.get(light.id);
      if (timer !== undefined) {
        window.clearTimeout(timer);
        departureTimersRef.current.delete(light.id);
      }
      return { ...(currentById.get(light.id) ?? light), ...light, leaving: false };
    });

    for (const light of visualLightsRef.current) {
      if (desiredIds.has(light.id) || next.length >= 12) continue;
      const departing = { ...light, leaving: true };
      next.push(departing);
      if (!departureTimersRef.current.has(light.id)) {
        const timer = window.setTimeout(() => {
          departureTimersRef.current.delete(light.id);
          visualLightsRef.current = visualLightsRef.current.filter(
            ({ id }) => id !== light.id,
          );
          setVisualLights(visualLightsRef.current);
        }, LIGHT_DEPARTURE_MS);
        departureTimersRef.current.set(light.id, timer);
      }
    }

    visualLightsRef.current = next;
    setVisualLights(next);
  }, [desiredLights]);

  useEffect(
    () => () => {
      departureTimersRef.current.forEach((timer) =>
        window.clearTimeout(timer),
      );
    },
    [],
  );

  useEffect(() => {
    const atmosphere = atmosphereRef.current;
    if (!atmosphere) return;
    const atmosphereStyle = atmosphere.style;
    const afterglowIntensity = house.afterglow.intensity / 1_000;
    house.afterglow.weights.forEach((weight, color) => {
      atmosphereStyle.setProperty(
        `--party-color-${color}`,
        String(
          clamp(
            activeWeights[color] * 0.82 +
              (weight / 1_000) * afterglowIntensity * 0.42,
            0,
            1,
          ),
        ),
      );
    });
    atmosphereStyle.setProperty(
      "--party-afterglow-intensity",
      String(afterglowIntensity),
    );
    atmosphereStyle.setProperty(
      "--party-presence-strength",
      String(presenceStrength),
    );
  }, [activeWeights, house.afterglow, presenceStrength]);

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
      atmosphereStyle.setProperty("--portal-pointer-turn", `${nextTurn}deg`);
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
        (
          clamp(horizontal - vertical * 0.45, -1, 1) * POINTER_TURN
        ).toFixed(2),
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
      data-afterglow={JSON.stringify({
        weights: house.afterglow.weights,
        intensity: house.afterglow.intensity,
      })}
      data-crowd={crowdLevel(house.presenceCount)}
      data-party-swell={
        house.swell === 0 ? "idle" : house.swell % 2 === 0 ? "even" : "odd"
      }
      data-testid="portal-atmosphere"
      ref={atmosphereRef}
    >
      <div className="portal-atmosphere-field" />
      <div className="portal-atmosphere-glass" />
      <div className="portal-house-lights">
        {visualLights.map((light) => (
          <i
            className="portal-house-light"
            data-color={light.color}
            data-energy={light.energy}
            data-leaving={light.leaving ? "true" : "false"}
            data-seed={light.seed % 12}
            data-self={house.self?.id === light.id ? "true" : "false"}
            data-sharing={light.sharing ? "true" : "false"}
            data-testid="party-light"
            data-zone={light.sharing ? light.zone : 4}
            key={light.id}
          />
        ))}
      </div>
      <div className="portal-house-waves">
        {house.knocks.map((knock) => (
          <i
            className="portal-house-wave"
            data-color={knock.color}
            data-self={house.self?.id === knock.lightId ? "true" : "false"}
            data-testid="party-knock-wave"
            data-zone={knock.zone}
            key={knock.eventId}
          />
        ))}
      </div>
      <div className="portal-house-pips">
        {visualLights.map((light) => (
          <i data-color={light.color} key={light.id} />
        ))}
      </div>
    </div>
  );
}
