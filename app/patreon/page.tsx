import type { Metadata } from "next";
import Link from "next/link";
import { ArrowIcon } from "../components/ArrowIcon";
import { PatreonOnly } from "../components/PatreonOnly";
import { PatreonUnlockForm } from "../components/PatreonUnlockForm";
import { SiteHeader } from "../components/SiteHeader";
import { normalizePatreonReturnTo } from "../lib/patreonAccess";

export const metadata: Metadata = {
  title: "Patreon Access — MISTAKES.PARTY",
  description: "The members-only door for patrons of Mistakes.party.",
  robots: { follow: false, index: false },
};

type PatreonPageProps = {
  searchParams: Promise<{
    returnTo?: string | string[];
  }>;
};

function LockedDoor({ returnTo }: { returnTo: string }) {
  return (
    <div className="patreon-door-grid">
      <header className="patreon-door-copy">
        <p className="mono-label">PATREON / MEMBERS ONLY</p>
        <h1>THE DOOR</h1>
        <p>
          PATRONS GET THE PASSWORD. THE PASSWORD GETS YOU INTO THE BACK ROOM.
        </p>
      </header>

      <section className="patreon-door-panel" aria-labelledby="member-entry-title">
        <p className="mono-label" id="member-entry-title">
          01 / MEMBER ENTRY
        </p>
        <PatreonUnlockForm returnTo={returnTo} />
        <div className="patreon-join">
          <span>NEED THE PASSWORD?</span>
          <a href="https://patreon.com/steaks">
            JOIN ON PATREON <ArrowIcon />
          </a>
        </div>
      </section>
    </div>
  );
}

function OpenDoor({ returnTo }: { returnTo: string }) {
  return (
    <div className="patreon-door-grid">
      <header className="patreon-door-copy">
        <p className="mono-label">PATREON / ACCESS READY</p>
        <h1>YOU&apos;RE IN</h1>
        <p>YOUR MEMBER PASS IS ACTIVE ON THIS BROWSER.</p>
      </header>

      <section className="patreon-door-panel" aria-labelledby="member-ready-title">
        <p className="mono-label" id="member-ready-title">
          01 / DOOR UNLOCKED
        </p>
        <Link className="patreon-enter-link" href={returnTo}>
          ENTER THE PATRON ROOM <ArrowIcon direction="right" />
        </Link>
        <div className="patreon-join">
          <span>BACK THE NEXT MISTAKE</span>
          <a href="https://patreon.com/steaks">
            VISIT PATREON <ArrowIcon />
          </a>
        </div>
      </section>
    </div>
  );
}

export default async function PatreonPage({ searchParams }: PatreonPageProps) {
  const requestedReturnTo = (await searchParams).returnTo;
  const returnTo = normalizePatreonReturnTo(
    Array.isArray(requestedReturnTo)
      ? requestedReturnTo[0]
      : requestedReturnTo,
  );

  return (
    <>
      <a className="skip-link" href="#patreon-content">
        SKIP TO MEMBER ACCESS
      </a>
      <SiteHeader currentPage="patreon" indexLink />

      <main className="patreon-page" id="patreon-content">
        <div className="patreon-status mono-label">
          <span>MISTAKES.PARTY SUPPORTERS</span>
          <span>SHARED PASS / 30 DAYS</span>
        </div>
        <PatreonOnly fallback={<LockedDoor returnTo={returnTo} />}>
          <OpenDoor returnTo={returnTo} />
        </PatreonOnly>
      </main>

      <footer className="site-footer">
        <span>MISTAKES.PARTY © 2026</span>
        <Link href="/">
          BACK TO THE INDEX <ArrowIcon direction="up" />
        </Link>
      </footer>
    </>
  );
}
