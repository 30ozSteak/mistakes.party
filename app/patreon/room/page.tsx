import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "../../components/SiteHeader";
import { requirePatreonAccess } from "../../lib/patreonAccess";
import { lockPatreonAccess } from "../actions";

export const metadata: Metadata = {
  title: "The Patron Room — MISTAKES.PARTY",
  description: "Patron-only experiments, notes, and useful mistakes.",
  robots: { follow: false, index: false },
};

export default async function PatreonRoomPage() {
  await requirePatreonAccess("/patreon/room");

  return (
    <>
      <a className="skip-link" href="#patreon-room-content">
        SKIP TO THE PATRON ROOM
      </a>
      <SiteHeader currentPage="patreon" indexLink />

      <main className="patreon-room-page" id="patreon-room-content">
        <section className="patreon-room-hero">
          <div className="patreon-status mono-label">
            <span>PATREON / ACCESS GRANTED</span>
            <span>PRIVATE SIGNAL 01</span>
          </div>
          <h1>THE BACK ROOM</h1>
          <p>
            PATRON-ONLY EXPERIMENTS, WORKS IN PROGRESS, DOWNLOADS, AND USEFUL
            MISTAKES LIVE HERE.
          </p>
        </section>

        <section className="patreon-room-grid" aria-label="Patron room notes">
          <article>
            <p className="mono-label">01 / YOU&apos;RE IN</p>
            <h2>THE DOOR WORKS.</h2>
            <p>
              This route is protected by the shared member pass and ready for
              the first private drop.
            </p>
          </article>
          <article>
            <p className="mono-label">02 / COMING THROUGH</p>
            <h2>MORE MISTAKES SOON.</h2>
            <p>
              Notes, early builds, downloads, and unfinished ideas can land
              here before they reach the public index.
            </p>
          </article>
        </section>

        <section className="patreon-room-actions" aria-label="Member actions">
          <a href="https://patreon.com/steaks">VISIT PATREON ↗</a>
          <form action={lockPatreonAccess}>
            <button type="submit">LOCK THIS BROWSER</button>
          </form>
        </section>
      </main>

      <footer className="site-footer">
        <span>MISTAKES.PARTY © 2026</span>
        <Link href="/">BACK TO THE INDEX ↑</Link>
      </footer>
    </>
  );
}
