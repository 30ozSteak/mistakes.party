import Link from "next/link";
import { GithubFeed } from "./components/GithubFeed";
import { MediumPostList } from "./components/MediumPostList";
import { SiteHeader } from "./components/SiteHeader";
import { archiveLinks, type Project, projects } from "./data";
import { getMediumPosts } from "./lib/medium";

type ArchiveLink = (typeof archiveLinks)[number];

const primaryCategories = ["WEBSITES", "TOOLS", "EXPERIMENTS"] as const;

export const revalidate = 900;

function ProjectRow({ project }: { project: Project }) {
  return (
    <article className="index-row">
      <Link className="index-main" href={`/work/${project.slug}`}>
        <h4 className="index-title">{project.title}</h4>
      </Link>
      <span className="index-meta">
        {project.kind} · {project.year}
      </span>
      <a
        aria-label={`View source for ${project.title}`}
        className="index-action"
        href={project.source}
      >
        SOURCE ↗
      </a>
    </article>
  );
}

function ArchiveRow({ link }: { link: ArchiveLink }) {
  return (
    <article className="index-row">
      <a className="index-main" href={link.href}>
        <h4 className="index-title">{link.label}</h4>
      </a>
      <span className="index-meta">{link.meta}</span>
      <span aria-hidden="true" className="index-action">
        OPEN ↗
      </span>
    </article>
  );
}

function ArchiveCategory({ category }: { category: ArchiveLink["category"] }) {
  const links = archiveLinks.filter((link) => link.category === category);

  return (
    <section className="index-category" aria-labelledby={`${category.toLowerCase().replace(" ", "-")}-label`}>
      <h3
        className="index-category-label"
        id={`${category.toLowerCase().replace(" ", "-")}-label`}
      >
        {category}
      </h3>
      <div className="index-list">
        {links.map((link) => (
          <ArchiveRow key={link.href} link={link} />
        ))}
      </div>
    </section>
  );
}

export default async function Home() {
  const publicCodeLinks = archiveLinks.filter(
    (link) => link.category === "PUBLIC CODE",
  );
  const mediumPosts = (await getMediumPosts()).slice(0, 5);

  return (
    <>
      <a className="skip-link" href="#work">
        SKIP TO THE WORK
      </a>
      <SiteHeader />

      <main id="content">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-lockup">
            <h1 id="hero-title" aria-label="MXP — Mistakes dot party">
              <span className="mxp" aria-hidden="true">
                <span>M</span>
                <span className="mxp-x">X</span>
                <span>P</span>
              </span>
            </h1>
            <p className="hero-intro">
              WEB / APPS / XR / GAMES / ART + THE OCCASIONAL USEFUL MISTAKE.
            </p>
          </div>
        </section>

        <div className="signal-stripes" aria-hidden="true" />

        <section className="work-index" id="work" aria-labelledby="work-index-title">
          <h2 className="sr-only" id="work-index-title">
            Work, code, and links
          </h2>

          {primaryCategories.map((category) => {
            const categoryProjects = projects.filter(
              (project) => project.category === category,
            );
            const categoryLinks = archiveLinks.filter(
              (link) => link.category === category,
            );

            return (
              <section
                className="index-category"
                aria-labelledby={`${category.toLowerCase()}-label`}
                key={category}
              >
                <h3
                  className="index-category-label"
                  id={`${category.toLowerCase()}-label`}
                >
                  {category}
                </h3>
                <div className="index-list">
                  {categoryProjects.map((project) => (
                    <ProjectRow key={project.slug} project={project} />
                  ))}
                  {categoryLinks.map((link) => (
                    <ArchiveRow key={link.href} link={link} />
                  ))}
                </div>
              </section>
            );
          })}

          <section
            className="index-category"
            id="blogs"
            aria-labelledby="blogs-label"
          >
            <h3 className="index-category-label" id="blogs-label">
              BLOGS
            </h3>
            <MediumPostList headingLevel="h4" posts={mediumPosts} />
            <div className="index-list">
              <article className="index-row">
                <Link className="index-main" href="/blogs">
                  <h4 className="index-title">ALL BLOGS</h4>
                </Link>
                <span className="index-meta">CURRENT MEDIUM FEED</span>
                <span aria-hidden="true" className="index-action">
                  VIEW →
                </span>
              </article>
            </div>
          </section>

          <section
            className="index-category"
            id="github"
            aria-labelledby="public-code-label"
          >
            <h3 className="index-category-label" id="public-code-label">
              PUBLIC CODE
            </h3>
            <GithubFeed />
            <div className="index-list">
              {publicCodeLinks.map((link) => (
                <ArchiveRow key={link.href} link={link} />
              ))}
            </div>
          </section>

          <ArchiveCategory category="ELSEWHERE" />
        </section>

        <section className="about" id="about" aria-label="About Mistakes dot party">
          <div className="about-grid">
            <p className="about-lede">
              MISTAKES.PARTY IS A DENVER HOME FOR WEB, APPS, XR, GAMES, ART +
              THE OCCASIONAL USEFUL MISTAKE.
            </p>
            <p className="about-note">
              SMALL TEAMS, SHARP INTERFACES, PUBLIC CODE, AND ENOUGH ROOM TO GET
              SOMETHING WRONG ON THE WAY TO GETTING IT RIGHT.
            </p>
          </div>
          <a className="contact-blast" href="mailto:hello@mistakes.party">
            SAY HELLO <span aria-hidden="true">↗</span>
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <span>MISTAKES.PARTY © 2026</span>
        <span>
          <a href="https://github.com/30ozSteak">GITHUB ↗</a> /{" "}
          <a href="https://x.com/iaaafm">X ↗</a>
        </span>
      </footer>
    </>
  );
}
