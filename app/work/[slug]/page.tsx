import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowIcon } from "../../components/ArrowIcon";
import { SiteHeader } from "../../components/SiteHeader";
import { getProject, projects } from "../../data";

type WorkPageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return projects.map((project) => ({ slug: project.slug }));
}

export async function generateMetadata({
  params,
}: WorkPageProps): Promise<Metadata> {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) return {};

  return {
    title: `${project.title} — MISTAKES.PARTY`,
    description: project.description,
  };
}

export default async function WorkPage({ params }: WorkPageProps) {
  const { slug } = await params;
  const project = getProject(slug);
  if (!project) notFound();

  const index = projects.findIndex((item) => item.slug === project.slug);
  const nextProject = projects[(index + 1) % projects.length];
  const distinctLaunch =
    project.launchUrl !== project.sourceUrl ? project.launchUrl : undefined;
  const hasExternalLinks = Boolean(distinctLaunch || project.sourceUrl);

  return (
    <>
      <a className="skip-link" href="#project-content">
        SKIP TO PROJECT
      </a>
      <SiteHeader />

      <main className="work-page" id="project-content">
        <section className="work-hero">
          <div className="work-kicker mono-label">
            <span>{String(index + 1).padStart(2, "0")} / SELECTED WORK</span>
            <span>{project.kind} / {project.visibility}</span>
          </div>
          <h1>{project.title}</h1>
          <p className="work-deck">{project.description}</p>
        </section>

        <section className="project-facts" aria-label="Project facts">
          <dl>
            <div><dt>YEAR</dt><dd>{project.year}</dd></div>
            <div><dt>ROLE</dt><dd>{project.role}</dd></div>
            <div><dt>STACK</dt><dd>{project.stack}</dd></div>
            <div><dt>STATUS</dt><dd>{project.status}</dd></div>
          </dl>
        </section>

        <section className="case-notes" aria-label="Project notes">
          <article><p className="case-number">01</p><h2>CONTEXT</h2><p>{project.context}</p></article>
          <article><p className="case-number">02</p><h2>THE MOVE</h2><p>{project.move}</p></article>
          <article><p className="case-number">03</p><h2>OUTCOME</h2><p>{project.outcome}</p></article>
        </section>

        {hasExternalLinks ? (
          <section className="project-links" aria-labelledby="project-links-title">
            <p className="mono-label" id="project-links-title">04 / KEEP GOING</p>
            <div>
              {distinctLaunch ? <a href={distinctLaunch}>LAUNCH PROJECT <ArrowIcon /></a> : null}
              {project.sourceUrl ? <a href={project.sourceUrl}>{project.sourceLabel ?? "VIEW SOURCE"} <ArrowIcon /></a> : null}
            </div>
          </section>
        ) : null}

        <Link className="next-project" href={`/work/${nextProject.slug}`}>
          <span className="mono-label">NEXT / {nextProject.kind}</span>
          <strong>{nextProject.title}</strong>
          <ArrowIcon direction="right" />
        </Link>
      </main>

      <footer className="site-footer">
        <span>MISTAKES.PARTY © 2026</span>
        <Link href="/"><span>BACK TO THE INDEX</span> <ArrowIcon direction="up" /></Link>
      </footer>
    </>
  );
}
