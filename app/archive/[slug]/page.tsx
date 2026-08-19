import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { archiveLinks, getArchiveLink } from "../../data";

type ArchivePageProps = {
  params: Promise<{ slug: string }>;
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
  };
}

export default async function ArchivePage({ params }: ArchivePageProps) {
  const { slug } = await params;
  const link = getArchiveLink(slug);
  if (!link) notFound();

  redirect(link.href);
}
