import type { Metadata } from "next";
import { SourceDetail } from "../components/SourceDetail";
import { GITHUB_OWNER } from "../lib/github";

const GITHUB_REPOSITORIES_URL =
  `https://github.com/${GITHUB_OWNER}?tab=repositories`;

export const metadata: Metadata = {
  title: "Public Code — MISTAKES.PARTY",
  description:
    "Public repositories, experiments, utilities, and useful mistakes from Mistakes.party.",
};

export default function CodePage() {
  return (
    <SourceDetail
      backHref="/"
      description="Public repositories, experiments, utilities, and useful mistakes—kept open for inspection, reuse, and the next attempt."
      facts={[
        { label: "OWNER", value: GITHUB_OWNER.toUpperCase() },
        { label: "PLATFORM", value: "GITHUB" },
        { label: "ACCESS", value: "PUBLIC" },
      ]}
      kicker="PUBLIC CODE / INDEX"
      kind="GITHUB / REPOSITORIES"
      note="This index highlights a small, changing selection. GitHub holds the complete working archive, including projects that are unfinished, narrowly useful, or preserved simply because the attempt mattered."
      noteTitle="THE WORKING ARCHIVE"
      sourceHref={GITHUB_REPOSITORIES_URL}
      sourceLabel="BROWSE GITHUB ↗"
      title="ALL REPOS"
    />
  );
}
