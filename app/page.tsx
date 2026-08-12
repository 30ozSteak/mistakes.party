import Link from "next/link";
import { GithubFeed } from "./components/GithubFeed";
import { SiteHeader } from "./components/SiteHeader";
import { archiveLinks, projects } from "./data";

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#work">
        SKIP TO THE WORK
      </a>
      <SiteHeader />

      <main id="content">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-lockup">
            <h1 id="hero-title">
              <span className="hero-line">
                <span className="steaks-display">STEAKS</span>
              </span>
              <span className="hero-line">MAKES</span>
              <span className="hero-line">WEIRD</span>
              <span className="hero-line">THINGS.</span>
            </h1>
            <p className="hero-intro">WEB / APPS / XR / GAMES / ART</p>
          </div>
        </section>

        <div className="signal-stripes" aria-hidden="true" />

        <section className="indexed-section" id="work" aria-labelledby="work-title">
          <div className="section-heading">
            <p className="section-number">01</p>
            <div className="section-heading-copy">
              <h2 id="work-title">WORK THAT LEFT A MARK.</h2>
              <p className="section-intro">
                PRODUCTS, EXPERIMENTS, AND PUBLIC TOOLS BUILT TO BE USED,
                BROKEN, AND MADE BETTER.
              </p>
            </div>
          </div>

          <div className="project-list">
            {projects.map((project, index) => (
              <article className="project-row" key={project.slug}>
                <span className="row-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <Link className="project-main" href={`/work/${project.slug}`}>
                  <h3 className="project-title">{project.title}</h3>
                  <span className="project-description">{project.description}</span>
                </Link>
                <span className="project-meta">
                  {project.kind}
                  <br />
                  {project.year}
                </span>
                <a
                  aria-label={`View source for ${project.title}`}
                  className="row-action"
                  href={project.source}
                >
                  SOURCE ↗
                </a>
              </article>
            ))}
          </div>
        </section>

        <section className="indexed-section github-section" id="github" aria-labelledby="github-title">
          <div className="section-heading">
            <p className="section-number">02</p>
            <div className="section-heading-copy">
              <h2 id="github-title">THE GITHUB WIRE.</h2>
              <p className="section-intro">
                RECENT PUBLIC REPOSITORIES, PULLED STRAIGHT FROM GITHUB AND
                LEFT OPEN FOR INSPECTION.
              </p>
            </div>
          </div>
          <GithubFeed />
        </section>

        <section className="indexed-section" aria-labelledby="links-title">
          <div className="section-heading section-heading--compact">
            <p className="section-number">03</p>
            <div className="section-heading-copy">
              <h2 id="links-title">KEEP CLICKING.</h2>
              <p className="section-intro">
                SOURCE CODE, SMALLER IDEAS, FORKS, NOTES, AND A FEW WAYS TO
                FIND ME ELSEWHERE.
              </p>
            </div>
          </div>

          <ol className="archive-list">
            {archiveLinks.map((link, index) => (
              <li key={link.href}>
                <a className="archive-row" href={link.href}>
                  <span className="row-index">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <span className="archive-copy">
                    <strong>{link.label}</strong>
                    <span className="archive-meta">{link.meta}</span>
                    <span className="archive-description">{link.description}</span>
                  </span>
                  <span className="archive-action">OPEN ↗</span>
                </a>
              </li>
            ))}
          </ol>
        </section>

        <section className="about" id="about" aria-labelledby="about-title">
          <div className="about-grid">
            <h2 id="about-title">MAKE IT USEFUL. MAKE IT LOUD.</h2>
            <div className="about-copy">
              <p>
                <mark className="steaks-mark">STEAKS</mark> IS A DENVER
                DESIGNER + DEVELOPER MAKING WEB, APPS, XR, GAMES + ART.
              </p>
              <p className="about-note">
                I LIKE SMALL TEAMS, SHARP INTERFACES, PUBLIC CODE, AND PROJECTS
                WITH ENOUGH PERSONALITY TO LEAVE A MARK.
              </p>
            </div>
          </div>
          <a className="contact-blast" href="mailto:hello@mistakes.party">
            SAY HELLO <span aria-hidden="true">↗</span>
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <span>
          <mark className="steaks-mark">STEAKS</mark> © 2026
        </span>
        <span>
          <a href="https://github.com/30ozSteak">GITHUB ↗</a> /{" "}
          <a href="https://x.com/iaaafm">X ↗</a>
        </span>
      </footer>
    </>
  );
}
