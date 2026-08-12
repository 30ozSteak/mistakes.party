export const GITHUB_OWNER = "30ozSteak";
export const GITHUB_REPO_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const GITHUB_ORIGIN = "https://github.com";
const MAX_CACHE_LENGTH = 256_000;
const REPO_NAME_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;
const ISO_TIMESTAMP_PATTERN =
  /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?Z$/;
const UNSAFE_DISPLAY_CHARACTERS = /[<>&\u0000-\u001f\u007f]/;

export type GithubRepo = {
  id: number;
  name: string;
  html_url: string;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
};

export type GithubRepoDetail = GithubRepo & {
  description: string | null;
};

export type GithubRepoDetailResult =
  | { status: "found"; repo: GithubRepoDetail }
  | { status: "not-found" }
  | { status: "unavailable" };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isGithubRepoName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    REPO_NAME_PATTERN.test(value) &&
    value !== "." &&
    value !== ".."
  );
}

function normalizeRepoDescription(value: unknown): string | null {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 500 ||
    value !== value.trim() ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }

  return value;
}

function isLanguage(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      value.length > 0 &&
      value.length <= 100 &&
      value === value.trim() &&
      !UNSAFE_DISPLAY_CHARACTERS.test(value))
  );
}

function isGithubTimestamp(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  const timestamp = Date.parse(value);
  if (!match || !Number.isFinite(timestamp)) return false;

  const milliseconds = (match[2] ?? "000").padEnd(3, "0");
  return new Date(timestamp).toISOString() === `${match[1]}.${milliseconds}Z`;
}

/**
 * Accept only a repository root URL for this site's GitHub account. Returning a
 * canonical URL keeps untrusted API and localStorage values out of link hrefs.
 */
export function normalizeGithubRepoUrl(
  value: unknown,
  expectedRepoName?: string,
): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 300 ||
    value !== value.trim()
  ) {
    return null;
  }

  try {
    const url = new URL(value);
    if (
      url.origin !== GITHUB_ORIGIN ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      return null;
    }

    const match = /^\/([^/]+)\/([^/]+)\/?$/.exec(url.pathname);
    if (!match) return null;

    const [, owner, repoName] = match;
    if (
      owner.toLowerCase() !== GITHUB_OWNER.toLowerCase() ||
      !isGithubRepoName(repoName) ||
      (expectedRepoName !== undefined &&
        repoName.toLowerCase() !== expectedRepoName.toLowerCase())
    ) {
      return null;
    }

    return `${GITHUB_ORIGIN}/${GITHUB_OWNER}/${repoName}`;
  } catch {
    return null;
  }
}

export function parseGithubRepo(value: unknown): GithubRepo | null {
  if (!isRecord(value)) return null;

  const {
    id,
    name,
    html_url: rawUrl,
    language,
    stargazers_count: stars,
    updated_at: updatedAt,
    fork,
    archived,
    disabled,
  } = value;

  if (
    !Number.isSafeInteger(id) ||
    (id as number) <= 0 ||
    !isGithubRepoName(name) ||
    !isLanguage(language) ||
    !Number.isSafeInteger(stars) ||
    (stars as number) < 0 ||
    !isGithubTimestamp(updatedAt) ||
    typeof fork !== "boolean" ||
    typeof archived !== "boolean" ||
    typeof disabled !== "boolean"
  ) {
    return null;
  }

  const htmlUrl = normalizeGithubRepoUrl(rawUrl, name);
  if (!htmlUrl) return null;

  return {
    id: id as number,
    name,
    html_url: htmlUrl,
    language,
    stargazers_count: stars as number,
    updated_at: updatedAt,
    fork,
    archived,
    disabled,
  };
}

export function parseGithubRepoDetail(value: unknown): GithubRepoDetail | null {
  const repo = parseGithubRepo(value);
  if (!repo || !isRecord(value)) return null;

  return {
    ...repo,
    description: normalizeRepoDescription(value.description),
  };
}

export function githubRepoUrl(repoName: unknown): string | null {
  if (!isGithubRepoName(repoName)) return null;
  return `${GITHUB_ORIGIN}/${GITHUB_OWNER}/${repoName}`;
}

export function parseGithubRepos(value: unknown): GithubRepo[] {
  if (!Array.isArray(value)) return [];

  const repos: GithubRepo[] = [];
  const seenIds = new Set<number>();
  const seenUrls = new Set<string>();

  for (const rawRepo of value) {
    const repo = parseGithubRepo(rawRepo);
    if (
      !repo ||
      seenIds.has(repo.id) ||
      seenUrls.has(repo.html_url.toLowerCase())
    ) {
      continue;
    }

    seenIds.add(repo.id);
    seenUrls.add(repo.html_url.toLowerCase());
    repos.push(repo);
  }

  return repos;
}

export function parseGithubRepoCache(
  serialized: string | null,
  now = Date.now(),
): GithubRepo[] | null {
  if (
    !serialized ||
    serialized.length > MAX_CACHE_LENGTH ||
    !Number.isSafeInteger(now) ||
    now < 0
  ) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(serialized);
    if (!isRecord(parsed)) return null;

    const { savedAt, repos: rawRepos } = parsed;
    if (
      !Number.isSafeInteger(savedAt) ||
      (savedAt as number) < 0 ||
      (savedAt as number) > now ||
      now - (savedAt as number) >= GITHUB_REPO_CACHE_TTL_MS ||
      !Array.isArray(rawRepos) ||
      rawRepos.length === 0 ||
      rawRepos.length > 2
    ) {
      return null;
    }

    const repos = parseGithubRepos(rawRepos);
    return repos.length === rawRepos.length ? repos : null;
  } catch {
    return null;
  }
}
