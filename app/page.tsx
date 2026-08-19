import { PortalAtmosphere } from "./components/PortalAtmosphere";
import { PortalDirectory } from "./components/PortalDirectory";
import { homeCategories } from "./data";

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
        </header>

        <PortalDirectory categories={homeCategories} />

        <footer className="portal-footer">
          <span>COLORADO</span>
          <span aria-hidden="true">/</span>
          <a href="mailto:hello@mistakes.party">HELLO@MISTAKES.PARTY</a>
        </footer>
      </main>
    </>
  );
}
