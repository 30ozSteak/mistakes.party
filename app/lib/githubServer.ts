import { cache } from "react";
import {
  GITHUB_OWNER,
  isGithubRepoName,
  parseGithubRepoDetail,
  type GithubRepoDetailResult,
} from "./github";

async function fetchGithubRepoDetail(
  repoName: unknown,
): Promise<GithubRepoDetailResult> {
  if (!isGithubRepoName(repoName)) return { status: "not-found" };

  try {
    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${encodeURIComponent(repoName)}`,
      {
        headers: { Accept: "application/vnd.github+json" },
        next: { revalidate: 900 },
        signal: AbortSignal.timeout(7000),
      },
    );
    if (response.status === 404) return { status: "not-found" };
    if (!response.ok) return { status: "unavailable" };

    const repo = parseGithubRepoDetail(await response.json());
    return repo ? { status: "found", repo } : { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

// A custom AbortSignal intentionally opts this fetch out of Next's automatic
// request memoization. React cache keeps generateMetadata and the page render
// on one bounded GitHub request while retaining the explicit timeout.
export const getGithubRepoDetail = cache(fetchGithubRepoDetail);
