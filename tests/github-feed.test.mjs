import assert from "node:assert/strict";
import test from "node:test";
import {
  GITHUB_REPO_CACHE_TTL_MS,
  normalizeGithubRepoUrl,
  parseGithubRepo,
  parseGithubRepoCache,
  parseGithubRepos,
} from "../app/lib/github.ts";

function githubRepo(overrides = {}) {
  return {
    id: 123,
    name: "mistakes-party",
    html_url: "https://github.com/30ozSteak/mistakes-party",
    description: "An API field the UI does not consume.",
    language: "TypeScript",
    stargazers_count: 4,
    updated_at: "2026-08-12T17:45:00Z",
    fork: false,
    archived: false,
    disabled: false,
    ...overrides,
  };
}

test("accepts only canonical repository links owned by 30ozSteak", () => {
  assert.equal(
    normalizeGithubRepoUrl(
      "https://GITHUB.com/30ozsteak/mistakes-party/",
      "mistakes-party",
    ),
    "https://github.com/30ozSteak/mistakes-party",
  );

  const hostileOrUnownedUrls = [
    "javascript:alert(1)",
    "http://github.com/30ozSteak/mistakes-party",
    "https://github.com.evil.test/30ozSteak/mistakes-party",
    "https://github.com/another-owner/mistakes-party",
    "https://attacker.test@github.com/30ozSteak/mistakes-party",
    "https://github.com/30ozSteak/mistakes-party/issues",
    "https://github.com/30ozSteak/mistakes-party?tab=code",
    "https://github.com/30ozSteak/mistakes-party#readme",
    "https://github.com/%33%30ozSteak/mistakes-party",
    " https://github.com/30ozSteak/mistakes-party",
  ];

  for (const url of hostileOrUnownedUrls) {
    assert.equal(normalizeGithubRepoUrl(url, "mistakes-party"), null, url);
  }

  assert.equal(
    normalizeGithubRepoUrl(
      "https://github.com/30ozSteak/a-different-repo",
      "mistakes-party",
    ),
    null,
  );
});

test("whitelists and validates every GitHub repo field used by the UI", () => {
  assert.deepEqual(parseGithubRepo(githubRepo()), {
    id: 123,
    name: "mistakes-party",
    html_url: "https://github.com/30ozSteak/mistakes-party",
    language: "TypeScript",
    stargazers_count: 4,
    updated_at: "2026-08-12T17:45:00Z",
    fork: false,
    archived: false,
    disabled: false,
  });

  const invalidOverrides = [
    { id: "123" },
    { id: 0 },
    { name: "<script>alert(1)</script>" },
    { html_url: "javascript:alert(1)" },
    { html_url: "https://github.com/30ozSteak/not-the-named-repo" },
    { language: "<img onerror=alert(1)>" },
    { language: " TypeScript" },
    { stargazers_count: -1 },
    { stargazers_count: 1.5 },
    { updated_at: "not-a-date" },
    { updated_at: "2026-02-30T17:45:00Z" },
    { updated_at: "2026-08-12T17:45:00-06:00" },
    { fork: "false" },
    { archived: null },
    { disabled: 0 },
  ];

  for (const overrides of invalidOverrides) {
    assert.equal(parseGithubRepo(githubRepo(overrides)), null);
  }
});

test("filters malformed and duplicate records from live GitHub payloads", () => {
  const secondRepo = githubRepo({
    id: 456,
    name: "another-repo",
    html_url: "https://github.com/30ozSteak/another-repo",
  });
  const repos = parseGithubRepos([
    githubRepo(),
    githubRepo({ html_url: "https://evil.test/payload" }),
    githubRepo(),
    secondRepo,
  ]);

  assert.deepEqual(
    repos.map((repo) => repo.name),
    ["mistakes-party", "another-repo"],
  );
  assert.deepEqual(parseGithubRepos({ repos: [githubRepo()] }), []);
});

test("accepts only fresh, fully valid cached repository records", () => {
  const now = 1_800_000_000_000;
  const serialize = (repos, savedAt = now - 1_000) =>
    JSON.stringify({ savedAt, repos });

  assert.equal(parseGithubRepoCache("not json", now), null);
  assert.equal(
    parseGithubRepoCache(
      serialize([githubRepo()], now - GITHUB_REPO_CACHE_TTL_MS),
      now,
    ),
    null,
  );
  assert.equal(
    parseGithubRepoCache(serialize([githubRepo()], now + 1), now),
    null,
  );
  assert.equal(
    parseGithubRepoCache(
      serialize([
        githubRepo(),
        githubRepo({ html_url: "javascript:alert(document.domain)" }),
      ]),
      now,
    ),
    null,
  );

  assert.deepEqual(
    parseGithubRepoCache(serialize([githubRepo()]), now)?.map(
      (repo) => repo.html_url,
    ),
    ["https://github.com/30ozSteak/mistakes-party"],
  );
});
