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
    <Link
      aria-label={project.title}
      className="index-row"
      data-drawing-anchor={`project:${project.slug}`}
      href={`/work/${project.slug}`}
    >
      <div className="index-main">
        <h4 className="index-title">{project.title}</h4>
      </div>
      <span className="index-meta">
        {project.kind} · {project.year}
      </span>
    </Link>
  );
}

function ArchiveRow({ link }: { link: ArchiveLink }) {
  return (
    <Link
      aria-label={link.label}
      className="index-row"
      data-drawing-anchor={`archive:${link.slug}`}
      href={`/archive/${link.slug}`}
    >
      <div className="index-main">
        <h4 className="index-title">{link.label}</h4>
      </div>
      <span className="index-meta">{link.meta}</span>
    </Link>
  );
}

function ArchiveCategory({ category }: { category: ArchiveLink["category"] }) {
  const links = archiveLinks.filter((link) => link.category === category);

  return (
    <section
      className="index-category"
      aria-labelledby={`${category.toLowerCase().replace(" ", "-")}-label`}
      data-drawing-anchor={`home:category:${category.toLowerCase().replace(" ", "-")}`}
    >
      <h3
        className="index-category-label"
        id={`${category.toLowerCase().replace(" ", "-")}-label`}
      >
        {category}
      </h3>
      <div className="index-list">
        {links.map((link) => (
          <ArchiveRow key={link.slug} link={link} />
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

      <main data-drawing-anchor="home" id="content">
        <section
          className="hero"
          aria-labelledby="hero-title"
          data-drawing-anchor="home:hero"
        >
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

        <div
          className="signal-stripes"
          aria-hidden="true"
          data-drawing-anchor="home:signal"
        />

        <section
          className="work-index"
          data-drawing-anchor="home:work"
          id="work"
          aria-labelledby="work-index-title"
        >
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
                data-drawing-anchor={`home:category:${category.toLowerCase()}`}
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
                    <ArchiveRow key={link.slug} link={link} />
                  ))}
                </div>
              </section>
            );
          })}

          <section
            className="index-category"
            data-drawing-anchor="home:category:blogs"
            id="blogs"
            aria-labelledby="blogs-label"
          >
            <h3 className="index-category-label" id="blogs-label">
              BLOGS
            </h3>
            <MediumPostList headingLevel="h4" posts={mediumPosts} />
            <div className="index-list">
              <Link
                aria-label="ALL BLOGS"
                className="index-row"
                data-drawing-anchor="blogs:index"
                href="/blogs"
              >
                <div className="index-main">
                  <h4 className="index-title">ALL BLOGS</h4>
                </div>
                <span className="index-meta">CURRENT MEDIUM FEED</span>
              </Link>
            </div>
          </section>

          <section
            className="index-category"
            data-drawing-anchor="home:category:public-code"
            id="github"
            aria-labelledby="public-code-label"
          >
            <h3 className="index-category-label" id="public-code-label">
              PUBLIC CODE
            </h3>
            <GithubFeed />
            <div className="index-list">
              {publicCodeLinks.map((link) => (
                <ArchiveRow key={link.slug} link={link} />
              ))}
            </div>
          </section>

          <ArchiveCategory category="ELSEWHERE" />
        </section>

        <section
          className="about"
          data-drawing-anchor="home:about"
          id="about"
          aria-label="About Mistakes dot party"
        >
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
          <a
            className="contact-blast"
            data-drawing-anchor="home:contact"
            href="mailto:hello@mistakes.party"
          >
            SAY HELLO <span aria-hidden="true">↗</span>
          </a>
        </section>
      </main>

      <footer className="site-footer" data-drawing-anchor="site-footer">
        <span>MISTAKES.PARTY © 2026</span>
        <span>
          <a href="https://github.com/30ozSteak">GITHUB ↗</a> /{" "}
          <a href="https://x.com/iaaafm">X ↗</a>
        </span>
      </footer>
    </>
  );
}
