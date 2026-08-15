import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import { SourceDetail } from "../../components/SourceDetail";
import {
  addMediumPostSlugs,
  getMediumPosts,
  isMediumPostSlug,
  type MediumPostWithSlug,
} from "../../lib/medium";

type BlogDetailPageProps = {
  params: Promise<{ slug: string }>;
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "long",
  timeZone: "UTC",
  year: "numeric",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value)).toUpperCase();
}

const findMediumPost = cache(async function findMediumPost(
  slug: string,
): Promise<MediumPostWithSlug | null> {
  if (!isMediumPostSlug(slug)) return null;

  const posts = addMediumPostSlugs(await getMediumPosts());
  return posts.find((post) => post.slug === slug) ?? null;
});

export async function generateStaticParams() {
  return addMediumPostSlugs(await getMediumPosts()).map((post) => ({
    slug: post.slug,
  }));
}

export async function generateMetadata({
  params,
}: BlogDetailPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = await findMediumPost(slug);

  if (!post) return {};

  return {
    title: `${post.title} — MISTAKES.PARTY`,
    description: `Read ${post.title} on Medium.`,
  };
}

export default async function BlogDetailPage({ params }: BlogDetailPageProps) {
  const { slug } = await params;
  const post = await findMediumPost(slug);
  if (!post) notFound();

  return (
    <SourceDetail
      backHref="/blogs"
      backLabel="BACK TO BLOGS"
      description="A dispatch from Mistakes.party, preserved here as a quick introduction before continuing to the original post."
      facts={[
        { label: "PUBLISHED", value: formatDate(post.publishedAt) },
        { label: "PLATFORM", value: "MEDIUM" },
        { label: "AUTHOR", value: "@30OZSTEAK" },
        { label: "STATUS", value: "PUBLIC" },
      ]}
      kicker="BLOG / DISPATCH"
      kind="MEDIUM"
      note="This page keeps the post discoverable inside the portfolio. The complete article, responses, and latest version live at the original source."
      noteTitle="ABOUT THIS POST"
      sourceHref={post.url}
      sourceLabel="READ ON MEDIUM"
      title={post.title}
    />
  );
}
