import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteHeader } from "../../components/SiteHeader";
import { getProject, projects } from "../../data";

type WorkPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return projects.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({ params }: WorkPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return {};

  return {
    title: `${project.title} — STEAKS`,
    description: project.description,
  };
}

export default async function WorkPage({ params }: WorkPageProps) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const index = projects.findIndex((item) => item.slug === project.slug);
  const nextProject = projects[(index + 1) % projects.length];

  return (
    <>
      <a className="skip-link" href="#project-content">
        SKIP TO PROJECT
      </a>
      <SiteHeader indexLink />

      <main id="project-content" className="work-page">
        <section className="work-hero">
          <div className="work-kicker mono-label">
            <span>{String(index + 1).padStart(2, "0")} / SELECTED WORK</span>
            <span>{project.kind}</span>
          </div>
          <h1>{project.title}</h1>
          <p className="work-deck">{project.description}</p>
        </section>

        <section className="project-facts" aria-label="Project facts">
          <dl>
            <div>
              <dt>YEAR</dt>
              <dd>{project.year}</dd>
            </div>
            <div>
              <dt>ROLE</dt>
              <dd>{project.role}</dd>
            </div>
            <div>
              <dt>STACK</dt>
              <dd>{project.stack}</dd>
            </div>
            <div>
              <dt>STATUS</dt>
              <dd>{project.status}</dd>
            </div>
          </dl>
        </section>

        <section className="case-notes" aria-label="Project notes">
          <article>
            <p className="case-number">01</p>
            <h2>CONTEXT</h2>
            <p>{project.context}</p>
          </article>
          <article>
            <p className="case-number">02</p>
            <h2>THE MOVE</h2>
            <p>{project.move}</p>
          </article>
          <article>
            <p className="case-number">03</p>
            <h2>OUTCOME</h2>
            <p>{project.outcome}</p>
          </article>
        </section>

        <section className="project-links" aria-labelledby="project-links-title">
          <p className="mono-label" id="project-links-title">
            04 / LEAVE THIS PAGE
          </p>
          <div>
            {project.launch ? (
              <a href={project.launch}>LAUNCH ↗</a>
            ) : null}
            <a href={project.source}>SOURCE ↗</a>
          </div>
        </section>

        <Link className="next-project" href={`/work/${nextProject.slug}`}>
          <span className="mono-label">NEXT / {nextProject.kind}</span>
          <strong>{nextProject.title}</strong>
          <span aria-hidden="true">→</span>
        </Link>
      </main>

      <footer className="site-footer">
        <span>
          <mark className="steaks-mark">STEAKS</mark> © 2026
        </span>
        <Link href="/">BACK TO THE INDEX ↑</Link>
      </footer>
    </>
  );
}
