import { PortalAtmosphere } from "./components/PortalAtmosphere";
import { PartySwitchboard } from "./components/PartyHouse";
import { MEDIUM_PROFILE_URL } from "./lib/medium";

const GITHUB_PROFILE_URL = "https://github.com/30ozSteak";
const ITCH_PROFILE_URL = "https://steaks.itch.io";
const SUPPORT_URL = "https://patreon.com/steaks";

const destinations = [
  { href: GITHUB_PROFILE_URL, label: "GITHUB", source: "github" },
  { href: MEDIUM_PROFILE_URL, label: "MEDIUM", source: "medium" },
  { href: ITCH_PROFILE_URL, label: "ITCH.IO", source: "itch" },
] as const;

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#elsewhere">
        SKIP TO THE LINKS
      </a>

      <main className="portal-home" id="content">
        <PortalAtmosphere />

        <header className="portal-masthead">
          <h1>MISTAKES.PARTY</h1>
          <PartySwitchboard surface="home" />
          <a href={SUPPORT_URL}>SUPPORT ↗</a>
        </header>

        <nav
          aria-label="Elsewhere"
          className="portal-destinations"
          id="elsewhere"
        >
          <ol>
            {destinations.map(({ href, label, source }) => (
              <li data-portal-section={source} key={source}>
                <a aria-label={label} className="portal-link" href={href}>
                  <span className="portal-name">{label}</span>
                  <span aria-hidden="true" className="portal-arrow">
                    ↗
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <footer className="portal-footer">
          <span>DENVER</span>
          <span aria-hidden="true">/</span>
          <a href="mailto:hello@mistakes.party">HELLO@MISTAKES.PARTY</a>
        </footer>
      </main>
    </>
  );
}
