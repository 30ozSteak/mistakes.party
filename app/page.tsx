const destinations = [
  {
    href: "https://github.com/30ozSteak",
    label: "GITHUB",
    number: "01",
  },
  {
    href: "https://medium.com/@30ozsteak",
    label: "MEDIUM",
    number: "02",
  },
  {
    href: "https://patreon.com/steaks",
    label: "PATREON",
    number: "03",
  },
  {
    href: "https://steaks.itch.io",
    label: "ITCH.IO",
    number: "04",
  },
] as const;

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#elsewhere">
        SKIP TO THE LINKS
      </a>

      <main
        className="portal-home"
        data-drawing-anchor="home"
        id="content"
      >
        <header
          className="portal-masthead"
          data-drawing-anchor="home:masthead"
        >
          <h1>MISTAKES.PARTY</h1>
          <span aria-hidden="true">MXP</span>
        </header>

        <nav
          aria-label="Elsewhere"
          className="portal-destinations"
          data-drawing-anchor="home:elsewhere"
          id="elsewhere"
        >
          <ol>
            {destinations.map((destination) => (
              <li key={destination.href}>
                <a
                  aria-label={destination.label}
                  className="portal-link"
                  data-drawing-anchor={`home:${destination.label.toLowerCase()}`}
                  href={destination.href}
                >
                  <span className="portal-number">{destination.number}</span>
                  <span className="portal-name">{destination.label}</span>
                  <span aria-hidden="true" className="portal-arrow">
                    ↗
                  </span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <footer className="portal-footer" data-drawing-anchor="home:footer">
          <span>DENVER</span>
          <span aria-hidden="true">/</span>
          <a href="mailto:hello@mistakes.party">HELLO@MISTAKES.PARTY</a>
        </footer>
      </main>
    </>
  );
}
