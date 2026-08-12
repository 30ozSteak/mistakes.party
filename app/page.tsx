import Link from "next/link";
import { GithubFeed } from "./components/GithubFeed";
import { SiteHeader } from "./components/SiteHeader";
import { archiveLinks, projects } from "./data";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#content">
        SKIP TO THE WORK
      </a>
      <SiteHeader />

      <main id="content">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-meta mono-label">
            <span>NICK / DESIGNER-DEVELOPER</span>
            <span>DENVER, CO / 2026</span>
          </div>

          <div className="hero-lockup">
            <h1 id="hero-title" aria-label="Mistakes dot party">
              <span className="hero-word hero-word--wide">MISTAKES</span>
              <span className="hero-word hero-word--party">
                DOT PARTY<span className="hero-period">.</span>
              </span>
            </h1>
            <p className="hero-intro">
              NICK MAKES <mark>XR/VR</mark>, WEBSITES, APPS, VIDEO GAMES + ART.
            </p>
          </div>

          <div className="hero-foot mono-label">
            <span>SCROLL / FOLLOW THE NUMBERS</span>
            <span>AVAILABLE FOR THE RIGHT WEIRD THING ↓</span>
          </div>
        </section>

        <div className="signal-stripes" aria-hidden="true" />

        <section className="indexed-section" id="work" aria-labelledby="work-title">
          <div className="section-heading">
            <p className="section-number">01</p>
            <div>
              <p className="mono-label">SELECTED / INTERNAL + EXTERNAL</p>
              <h2 id="work-title">WORK THAT LEFT A MARK.</h2>
            </div>
          </div>

          <div className="project-list">
            {projects.map((project, index) => (
              <article className="project-row" key={project.slug}>
                <span className="row-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Link className="project-main" href={`/work/${project.slug}`}>
                  <span className="project-title">{project.title}</span>
                  <span className="project-description">{project.description}</span>
                </Link>
                <span className="project-meta">
                  {project.kind}
                  <br />
                  {project.year}
                </span>
                <a className="row-action" href={project.source}>
                  SOURCE ↗
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="indexed-section github-section" id="github" aria-labelledby="github-title">
          <div className="section-heading">
            <p className="section-number">02</p>
            <div>
              <p className="mono-label">PUBLIC CODE / PULLED LIVE</p>
              <h2 id="github-title">THE GITHUB WIRE.</h2>
            </div>
          </div>
          <GithubFeed />
        </section>

        <section className="indexed-section" aria-labelledby="links-title">
          <div className="section-heading section-heading--compact">
            <p className="section-number">03</p>
            <div>
              <p className="mono-label">LINKS / SOURCES / LOOSE ENDS</p>
              <h2 id="links-title">KEEP CLICKING.</h2>
            </div>
          </div>

          <ol className="archive-list">
            {archiveLinks.map((link, index) => (
              <li key={link.href}>
                <a className="archive-row" href={link.href}>
                  <span className="row-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <strong>{link.label}</strong>
                  <span>{link.detail}</span>
                  <span className="row-action">OPEN ↗</span>
                </a>
              </li>
            ))}
          </ol>
        </section>

        <section className="about" id="about" aria-labelledby="about-title">
          <div className="about-index mono-label">04 / ABOUT THE PERSON</div>
          <div className="about-grid">
            <h2 id="about-title">MAKE IT USEFUL. MAKE IT LOUD.</h2>
            <div className="about-copy">
              <p>
                I&apos;M NICK — A DENVER-BASED DESIGNER AND DEVELOPER MAKING
                WEBSITES, APPS, XR/VR, GAMES, ART, AND THE OCCASIONAL USEFUL
                MISTAKE.
              </p>
              <p className="mono-label">
                CURRENTLY INTERESTED IN SMALL TOOLS, STRONG INTERFACES, AND
                INTERNET THINGS WITH AN ACTUAL POINT OF VIEW.
              </p>
            </div>
          </div>
          <a className="contact-blast" href="mailto:hello@mistakes.party">
            SAY HELLO <span aria-hidden="true">↗</span>
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <span>MISTAKES.PARTY © 2026</span>
        <span>DENVER / MOUNTAIN TIME</span>
        <span>
          <a href="https://github.com/30ozSteak">GITHUB ↗</a> /{" "}
          <a href="https://x.com/iaaafm">X ↗</a>
        </span>
      </footer>
    </>
  );
}
