"use client";

import { useRef, useState } from "react";
import { usePartyHouse } from "./PartyHouse";
import styles from "./BalloonGuestbook.module.css";

function shownPresence(count: number | null): string {
  if (count === null) return "…";
  if (count > 99) return "99+";
  return String(count);
}

function balloonPath(eventId: string): number {
  let hash = 0;
  for (let index = 0; index < eventId.length; index += 1) {
    hash = (hash * 31 + eventId.charCodeAt(index)) >>> 0;
  }
  return hash % 8;
}

export function BalloonGuestbook() {
  const house = usePartyHouse();
  const [dialogOpen, setDialogOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const count = shownPresence(house.presenceCount);
  const interactive =
    house.connectionState === "live" && house.mode === "live";

  if (
    !house.configured ||
    !house.hydrated ||
    !house.eligible ||
    house.mode === "presence" ||
    house.connectionState === "off" ||
    house.connectionState === "full"
  ) {
    return null;
  }

  function openGuestbook() {
    const dialog = dialogRef.current;
    if (!dialog || dialog.open) return;
    dialog.showModal();
    setDialogOpen(true);
    window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLButtonElement>("[data-guestbook-primary]")?.focus();
    });
  }

  function handleTrigger() {
    if (house.hasLeftBalloon) {
      openGuestbook();
      return;
    }
    house.leaveBalloon();
  }

  function closeGuestbook() {
    const dialog = dialogRef.current;
    if (dialog?.open) dialog.close();
    else setDialogOpen(false);
  }

  function handleDialogClosed() {
    setDialogOpen(false);
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }

  const triggerDisabled =
    !house.hasLeftBalloon && (!house.balloonAvailable || house.balloonPending);
  const triggerLabel = house.hasLeftBalloon
    ? `Balloon left. Open the guestbook. ${count} anonymous ${
        house.presenceCount === 1 ? "light is" : "lights are"
      } here.`
    : house.balloonPending
      ? "Your anonymous balloon is leaving."
      : interactive
        ? `${count} anonymous ${
            house.presenceCount === 1 ? "light is" : "lights are"
          } here. Leave one balloon in the shared guestbook.`
        : "The balloon guestbook is reconnecting.";

  return (
    <aside
      aria-label="Balloon guestbook"
      className={styles.root}
      data-connection={house.connectionState}
      data-party-guestbook=""
      data-testid="party-guestbook"
    >
      <div aria-hidden="true" className={styles.balloonLayer}>
        {house.balloons.map((balloon) => (
          <i
            className={styles.balloonEvent}
            data-color={balloon.color}
            data-path={balloonPath(balloon.eventId)}
            data-self={house.self?.id === balloon.lightId ? "true" : "false"}
            data-testid="party-balloon"
            key={balloon.eventId}
          />
        ))}
      </div>

      {house.balloonConfirmed ? (
        <div
          aria-hidden="true"
          className={styles.confirmation}
          data-testid="party-balloon-confirmation"
        >
          <strong>BALLOON LEFT</strong>
          <span>THE COLOR LINGERS FOR 24 HOURS</span>
        </div>
      ) : null}

      <button
        aria-controls={house.hasLeftBalloon ? "balloon-guestbook-dialog" : undefined}
        aria-expanded={house.hasLeftBalloon ? dialogOpen : undefined}
        aria-haspopup={house.hasLeftBalloon ? "dialog" : undefined}
        aria-label={triggerLabel}
        className={styles.trigger}
        data-balloon-left={house.hasLeftBalloon ? "true" : "false"}
        data-testid="party-balloon-trigger"
        disabled={triggerDisabled}
        onClick={handleTrigger}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className={styles.triggerBalloon} />
        <span aria-hidden="true" className={styles.triggerCount}>
          {house.balloonPending ? "SENDING" : `${count} HERE`}
        </span>
      </button>

      {house.hasLeftBalloon ? (
        <dialog
          aria-labelledby="balloon-guestbook-title"
          className={styles.dialog}
          data-testid="party-balloon-dialog"
          id="balloon-guestbook-dialog"
          onClick={(event) => {
            if (event.target === event.currentTarget) closeGuestbook();
          }}
          onClose={handleDialogClosed}
          ref={dialogRef}
          tabIndex={-1}
        >
          <div className={styles.sheet}>
            <button
              aria-label="Close balloon guestbook"
              className={styles.close}
              onClick={closeGuestbook}
              type="button"
            >
              ×
            </button>
            <p className={styles.eyebrow}>{count} HERE NOW</p>
            <h2 id="balloon-guestbook-title">YOUR BALLOON IS HERE</h2>
            <p className={styles.explanation}>
              IT FLOATED PAST EVERYONE HERE. ITS ANONYMOUS COLOR STAYS IN THE
              HOUSE FOR 24 HOURS.
            </p>
            <div className={styles.lightControl}>
              <div>
                <strong>MY LIGHT</strong>
                <span>SHARES ONLY WHETHER YOU ARE IN GITHUB OR MEDIUM.</span>
              </div>
              <button
                aria-label={`Category-level shared light ${
                  house.motionEnabled ? "on" : "off"
                }. Shares only whether you are exploring GitHub or Medium.`}
                aria-pressed={house.motionEnabled}
                className={styles.motion}
                data-guestbook-primary=""
                data-testid="party-motion"
                disabled={!interactive}
                onClick={() => house.setMotionEnabled(!house.motionEnabled)}
                type="button"
              >
                {house.motionEnabled ? "ON" : "OFF"}
              </button>
            </div>
            {!interactive ? (
              <p aria-live="polite" className={styles.connection} role="status">
                RECONNECTING…
              </p>
            ) : null}
          </div>
        </dialog>
      ) : null}
    </aside>
  );
}
