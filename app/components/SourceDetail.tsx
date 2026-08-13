import Link from "next/link";
import { SiteHeader } from "./SiteHeader";

type SourceDetailFact = {
  label: string;
  value: string;
};

type SourceDetailProps = {
  backHref?: string;
  backLabel?: string;
  description: string;
  drawingAnchorId: string;
  facts: SourceDetailFact[];
  kicker: string;
  kind: string;
  note: string;
  noteTitle: string;
  sourceHref: string;
  sourceLabel: string;
  title: string;
};

export function SourceDetail({
  backHref = "/",
  backLabel = "BACK TO THE INDEX ↑",
  description,
  drawingAnchorId,
  facts,
  kicker,
  kind,
  note,
  noteTitle,
  sourceHref,
  sourceLabel,
  title,
}: SourceDetailProps) {
  return (
    <>
      <a className="skip-link" href="#source-content">
        SKIP TO DETAILS
      </a>
      <SiteHeader indexLink />

      <main
        className="work-page source-detail"
        data-drawing-anchor={drawingAnchorId}
        id="source-content"
      >
        <section
          className="work-hero"
          data-drawing-anchor={`${drawingAnchorId}:hero`}
        >
          <div className="work-kicker mono-label">
            <span>{kicker}</span>
            <span>{kind}</span>
          </div>
          <h1>{title}</h1>
          <p className="work-deck">{description}</p>
        </section>

        <section
          className="project-facts"
          aria-label="Item facts"
          data-drawing-anchor={`${drawingAnchorId}:facts`}
        >
          <dl>
            {facts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section
          className="case-notes source-notes"
          aria-label="About this item"
          data-drawing-anchor={`${drawingAnchorId}:notes`}
        >
          <article>
            <p className="case-number">01</p>
            <h2>{noteTitle}</h2>
            <p>{note}</p>
          </article>
        </section>

        <section
          className="project-links"
          aria-labelledby="source-link-title"
          data-drawing-anchor={`${drawingAnchorId}:links`}
        >
          <p className="mono-label" id="source-link-title">
            02 / KEEP GOING
          </p>
          <div>
            <a href={sourceHref}>{sourceLabel}</a>
          </div>
        </section>
      </main>

      <footer className="site-footer" data-drawing-anchor="site-footer">
        <span>MISTAKES.PARTY © 2026</span>
        <Link href={backHref}>{backLabel}</Link>
      </footer>
    </>
  );
}
