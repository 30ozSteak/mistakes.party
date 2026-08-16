"use client";

import {
  useEffect,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import type { PartyHouseRoom } from "../lib/partyHouseProtocol";
import { ArrowIcon } from "./ArrowIcon";
import { usePartyHouse } from "./PartyHouse";

export type PortalDestination = {
  href: string;
  label: string;
  preview: {
    label: string;
    meta: string;
  };
  previewLabel: string;
  room: Exclude<PartyHouseRoom, "lobby">;
  source: "github" | "medium";
};

function lightCopy(count: number): string {
  if (count === 0) return "ROOM QUIET";
  if (count === 1) return "1 LIGHT HERE";
  return `${count} LIGHTS HERE`;
}

export function PortalDirectory({
  destinations,
  previews,
}: {
  destinations: PortalDestination[];
  previews?: ReactNode[];
}) {
  const house = usePartyHouse();
  const [openSource, setOpenSource] = useState<PortalDestination["source"] | null>(
    null,
  );
  const setRoom = house.setRoom;

  useEffect(() => () => setRoom("lobby"), [setRoom]);

  function setOpen(destination: PortalDestination) {
    const opening = openSource !== destination.source;
    setOpenSource(opening ? destination.source : null);
    house.setRoom(opening ? destination.room : "lobby");
  }

  function handleFocusLeaving(
    event: FocusEvent<HTMLLIElement>,
    source: PortalDestination["source"],
  ) {
    const next = event.relatedTarget;
    if (
      next instanceof Node &&
      event.currentTarget.contains(next)
    ) {
      return;
    }
    if (openSource !== source) house.setRoom("lobby");
  }

  return (
    <nav aria-label="Elsewhere" className="portal-destinations" id="elsewhere">
      <ol>
        {destinations.map((destination, index) => {
          const open = openSource === destination.source;
          const panelId = `portal-panel-${destination.source}`;
          const roomCount = house.roomCounts[destination.room];

          return (
            <li
              data-open={open ? "true" : "false"}
              data-portal-section={destination.source}
              key={destination.source}
              onBlurCapture={(event) =>
                handleFocusLeaving(event, destination.source)
              }
              onFocusCapture={() => house.setRoom(destination.room)}
              onPointerEnter={() => house.setRoom(destination.room)}
              onPointerLeave={() => {
                if (!open) house.setRoom("lobby");
              }}
            >
              <button
                aria-controls={panelId}
                aria-expanded={open}
                className="portal-link"
                onClick={() => setOpen(destination)}
                type="button"
              >
                <span className="portal-link-copy">
                  <span className="portal-name">{destination.label}</span>
                  <span className="portal-link-meta">
                    <span aria-hidden="true" className="portal-summary">
                      {destination.preview.meta}
                    </span>
                    <span className="portal-room-count">
                      {lightCopy(roomCount)}
                    </span>
                  </span>
                </span>
                <span className="portal-link-end">
                  <span aria-hidden="true" className="portal-arrow">
                    <ArrowIcon direction="right" />
                  </span>
                </span>
              </button>

              <div className="portal-panel" hidden={!open} id={panelId}>
                <div className="portal-preview">
                  <span className="portal-preview-label">
                    {destination.previewLabel}
                  </span>
                  {previews?.[index] ?? (
                    <div className="portal-preview-item">
                      <strong>{destination.preview.label}</strong>
                      <span>{destination.preview.meta}</span>
                    </div>
                  )}
                </div>

                <div className="portal-panel-actions">
                  <a className="portal-external" href={destination.href}>
                    OPEN {destination.label} <ArrowIcon />
                  </a>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
