import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SourceDetail } from "../../components/SourceDetail";
import {
  archiveLinks,
  getArchiveLink,
  type ArchiveSourceProvider,
} from "../../data";

type ArchivePageProps = {
  params: Promise<{ slug: string }>;
};

const sourceNotes: Record<ArchiveSourceProvider, string> = {
  GITHUB:
    "This page keeps the context close, but the repository is the artifact. Continue to GitHub for the code, commit history, documentation, and anything that changed after this note was published.",
  X:
    "This page is only a signpost. Continue to X for the short updates, works in progress, links, and stray observations as they are published.",
  EMAIL:
    "The useful next step is a real conversation. Send an email with the problem, collaboration, or half-formed idea you want to talk through.",
};

export const dynamicParams = false;

export function generateStaticParams() {
  return archiveLinks.map((link) => ({ slug: link.slug }));
}

export async function generateMetadata({
  params,
}: ArchivePageProps): Promise<Metadata> {
  const { slug } = await params;
  const link = getArchiveLink(slug);
  if (!link) return {};

  return {
    title: `${link.label} — MISTAKES.PARTY`,
    description: link.description,
    alternates: {
      canonical: `/archive/${link.slug}`,
    },
    openGraph: {
      type: "website",
      title: `${link.label} — MISTAKES.PARTY`,
      description: link.description,
      url: `/archive/${link.slug}`,
    },
  };
}

export default async function ArchivePage({ params }: ArchivePageProps) {
  const { slug } = await params;
  const link = getArchiveLink(slug);
  if (!link) notFound();

  const index = archiveLinks.findIndex((item) => item.slug === link.slug);
  const visibility = link.sourceProvider === "EMAIL" ? "DIRECT" : "PUBLIC";

  return (
    <SourceDetail
      description={link.description}
      facts={[
        { label: "CATEGORY", value: link.category },
        { label: "FORMAT", value: link.meta },
        { label: "SOURCE", value: link.sourceProvider },
        { label: "ACCESS", value: visibility },
      ]}
      kicker={`${String(index + 1).padStart(2, "0")} / ARCHIVE`}
      kind={link.meta}
      note={sourceNotes[link.sourceProvider]}
      noteTitle="FOLLOW THE SOURCE"
      sourceHref={link.href}
      sourceLabel={link.sourceLabel}
      title={link.label}
    />
  );
}
