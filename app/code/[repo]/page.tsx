import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SourceDetail } from "../../components/SourceDetail";
import {
  githubRepoUrl,
  isGithubRepoName,
} from "../../lib/github";
import { getGithubRepoDetail } from "../../lib/githubServer";

type CodeDetailPageProps = {
  params: Promise<{ repo: string }>;
};

export const revalidate = 900;

function formatUpdatedAt(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  })
    .format(new Date(value))
    .toUpperCase();
}

export async function generateMetadata({
  params,
}: CodeDetailPageProps): Promise<Metadata> {
  const { repo } = await params;
  if (!isGithubRepoName(repo)) return {};

  const result = await getGithubRepoDetail(repo);
  if (result.status === "not-found") return {};
  const detail = result.status === "found" ? result.repo : null;
  const title = detail?.name ?? repo;
  const description =
    detail?.description ??
    `View ${title}, a public GitHub repository from Mistakes.party.`;

  return {
    title: `${title} — MISTAKES.PARTY`,
    description,
  };
}

export default async function CodeDetailPage({ params }: CodeDetailPageProps) {
  const { repo } = await params;
  if (!isGithubRepoName(repo)) notFound();

  const sourceHref = githubRepoUrl(repo);
  if (!sourceHref) notFound();

  const result = await getGithubRepoDetail(repo);
  if (result.status === "not-found") notFound();
  const detail = result.status === "found" ? result.repo : null;
  const title = detail?.name ?? repo;
  const description =
    detail?.description ??
    "A public code project from the working archive. GitHub has the source, history, and latest state of the experiment.";
  const facts = detail
    ? [
        { label: "LANGUAGE", value: detail.language ?? "CODE" },
        { label: "STARS", value: String(detail.stargazers_count) },
        { label: "UPDATED", value: formatUpdatedAt(detail.updated_at) },
        {
          label: "STATUS",
          value: detail.archived ? "ARCHIVED" : "PUBLIC",
        },
      ]
    : [
        { label: "PLATFORM", value: "GITHUB" },
        { label: "ACCESS", value: "PUBLIC" },
        { label: "STATUS", value: "VIEW SOURCE" },
      ];

  return (
    <SourceDetail
      backHref="/"
      description={description}
      drawingAnchorId={`repository:${repo.toLowerCase()}`}
      facts={facts}
      kicker="PUBLIC CODE / REPOSITORY"
      kind={detail?.language ?? "GITHUB / CODE"}
      note="The repository is the authoritative record for this project: inspect the implementation, browse its history, or take it somewhere new."
      noteTitle="ABOUT THE SOURCE"
      sourceHref={sourceHref}
      sourceLabel="VIEW ON GITHUB ↗"
      title={title}
    />
  );
}
