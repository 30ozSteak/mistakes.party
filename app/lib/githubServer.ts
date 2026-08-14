import { cache } from "react";
import {
  GITHUB_OWNER,
  isGithubRepoName,
  parseGithubRepoDetail,
  parseGithubRepos,
  type GithubRepo,
  type GithubRepoDetailResult,
} from "./github";

const GITHUB_REPOS_PER_PAGE = 100;
const MAX_GITHUB_REPO_PAGES = 10;
const DEFAULT_GITHUB_REPOS_URL =
  `https://api.github.com/users/${GITHUB_OWNER}/repos`;

function githubReposUrl(page: number): string {
  let baseUrl = DEFAULT_GITHUB_REPOS_URL;
  const configuredUrl = process.env.GITHUB_REPOS_URL?.trim();

  // Production always uses GitHub. Tests may explicitly opt into their own
  // ephemeral loopback fixture without opening a general-purpose fetch proxy.
  if (configuredUrl && process.env.GITHUB_REPOS_ALLOW_LOCALHOST === "1") {
    try {
      const url = new URL(configuredUrl);
      const isLoopback =
        url.hostname === "127.0.0.1" || url.hostname === "localhost";
      if (
        url.protocol === "http:" &&
        isLoopback &&
        !url.username &&
        !url.password &&
        !url.hash
      ) {
        baseUrl = url.toString();
      }
    } catch {
      // Ignore invalid test-only overrides and keep the fixed GitHub endpoint.
    }
  }

  const url = new URL(baseUrl);
  url.search = "";
  url.searchParams.set("type", "owner");
  url.searchParams.set("per_page", String(GITHUB_REPOS_PER_PAGE));
  url.searchParams.set("sort", "updated");
  url.searchParams.set("page", String(page));
  return url.toString();
}

async function fetchGithubRepos(): Promise<GithubRepo[]> {
  try {
    const rawRepos: unknown[] = [];
    let collectionComplete = false;
    const signal = AbortSignal.timeout(7000);

    for (let page = 1; page <= MAX_GITHUB_REPO_PAGES; page += 1) {
      const response = await fetch(
        githubReposUrl(page),
        {
          headers: { Accept: "application/vnd.github+json" },
          next: { revalidate: 900 },
          signal,
        },
      );
      if (!response.ok) return [];

      const payload: unknown = await response.json();
      if (!Array.isArray(payload)) return [];
      rawRepos.push(...payload);

      if (payload.length < GITHUB_REPOS_PER_PAGE) {
        collectionComplete = true;
        break;
      }
    }

    // Never present a silently truncated collection as the full index.
    if (!collectionComplete) return [];

    return parseGithubRepos(rawRepos).sort(
      (a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at),
    );
  } catch {
    return [];
  }
}

async function fetchGithubRepoDetail(
  repoName: unknown,
): Promise<GithubRepoDetailResult> {
  if (!isGithubRepoName(repoName)) return { status: "not-found" };

  try {
    // Resolve against the owner's bounded, constant-key repository index
    // before constructing a detail URL. Otherwise an attacker can generate
    // unlimited valid-looking slugs and force a new outbound request/cache key
    // for every one. An unavailable index is different from a confirmed miss.
    const repos = await fetchGithubRepos();
    if (repos.length === 0) return { status: "unavailable" };
    const indexedRepo = repos.find(
      ({ name }) => name.toLowerCase() === repoName.toLowerCase(),
    );
    if (!indexedRepo) return { status: "not-found" };

    const response = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${encodeURIComponent(indexedRepo.name)}`,
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

// Keep the public index server-rendered while sharing its bounded, paginated
// request within each render pass.
export const getGithubRepos = cache(fetchGithubRepos);
