import type { Metadata } from "next";
import Link from "next/link";
import { ArrowIcon } from "../components/ArrowIcon";
import { SiteHeader } from "../components/SiteHeader";
import { projects } from "../data";

export const metadata: Metadata = {
  title: "Projects — MISTAKES.PARTY",
  description: "A curated index of public and private Mistakes.party projects.",
};

export default function CodePage() {
  return (
    <>
      <a className="skip-link" href="#project-index">
        SKIP TO THE PROJECTS
      </a>
      <SiteHeader />

      <main className="blogs-page" id="project-index">
        <header className="blogs-hero">
          <h1>PROJECTS</h1>
          <p className="projects-intro mono-label">
            PUBLIC WORK, PRIVATE WORK, AND USEFUL ATTEMPTS—CURATED HERE.
          </p>
        </header>

        <section className="blogs-index" aria-label="Project index">
          <div className="index-list">
            {projects.map((project) => (
              <Link
                aria-label={project.title}
                className="index-row"
                data-project
                href={`/work/${project.slug}`}
                key={project.slug}
              >
                <div className="index-main">
                  <h2 className="index-title">{project.title}</h2>
                </div>
                <span className="index-meta">
                  <span>{project.category}</span>
                  <span>{project.visibility}</span>
                  <span>{project.status}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>
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
