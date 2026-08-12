"use client";

import { useEffect, useState } from "react";

type GithubRepo = {
  id: number;
  name: string;
  html_url: string;
  description: string | null;
  language: string | null;
  stargazers_count: number;
  updated_at: string;
  fork: boolean;
  archived: boolean;
  disabled: boolean;
};

type FeedState = "loading" | "live" | "cached" | "fallback";

const CACHE_KEY = "mistakes-party.github.v1";
const CACHE_TTL = 6 * 60 * 60 * 1000;

const fallbackRepos: GithubRepo[] = [
  {
    id: 1,
    name: "lighthouse-checker",
    html_url: "https://github.com/30ozSteak/lighthouse-checker",
    description: "A public web-performance utility.",
    language: null,
    stargazers_count: 0,
    updated_at: "",
    fork: false,
    archived: false,
    disabled: false,
  },
  {
    id: 2,
    name: "ITADW",
    html_url: "https://github.com/30ozSteak/ITADW",
    description: "An experiment from the public code archive.",
    language: null,
    stargazers_count: 0,
    updated_at: "",
    fork: false,
    archived: false,
    disabled: false,
  },
];

function isRepo(value: unknown): value is GithubRepo {
  if (!value || typeof value !== "object") return false;
  const repo = value as Partial<GithubRepo>;
  return (
    typeof repo.id === "number" &&
    typeof repo.name === "string" &&
    typeof repo.html_url === "string" &&
    typeof repo.updated_at === "string"
  );
}

function formatDate(value: string) {
  if (!value) return "PUBLIC";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    year: "numeric",
  })
    .format(new Date(value))
    .toUpperCase();
}

export function GithubFeed() {
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [feedState, setFeedState] = useState<FeedState>("loading");

  useEffect(() => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);

    async function loadRepos() {
      try {
        const cached = window.localStorage.getItem(CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached) as {
            savedAt?: number;
            repos?: unknown[];
          };
          const cachedRepos = Array.isArray(parsed.repos)
            ? parsed.repos.filter(isRepo)
            : [];

          if (
            cachedRepos.length > 0 &&
            typeof parsed.savedAt === "number" &&
            Date.now() - parsed.savedAt < CACHE_TTL
          ) {
            setRepos(cachedRepos);
            setFeedState("cached");
            return;
          }
        }

        const response = await fetch(
          "https://api.github.com/users/30ozSteak/repos?type=owner&per_page=100&sort=updated",
          {
            headers: { Accept: "application/vnd.github+json" },
            signal: controller.signal,
          },
        );

        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        const payload: unknown = await response.json();
        if (!Array.isArray(payload)) throw new Error("Unexpected GitHub response");

        const publicRepos = payload
          .filter(isRepo)
          .filter((repo) => !repo.fork && !repo.archived && !repo.disabled)
          .sort(
            (a, b) =>
              new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
          )
          .slice(0, 6);

        if (publicRepos.length === 0) throw new Error("No public repositories");

        setRepos(publicRepos);
        setFeedState("live");
        window.localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ savedAt: Date.now(), repos: publicRepos }),
        );
      } catch {
        if (!controller.signal.aborted) {
          setRepos(fallbackRepos);
          setFeedState("fallback");
        } else {
          setRepos(fallbackRepos);
          setFeedState("fallback");
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadRepos();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  const statusCopy = {
    loading: "CONTACTING GITHUB…",
    live: "LIVE DATA / GITHUB API",
    cached: "RECENT DATA / LOCAL CACHE",
    fallback: "GITHUB IS QUIET / SHOWING THE INDEX",
  }[feedState];

  return (
    <div className="github-feed">
      <p className="github-status" aria-live="polite">
        <span className={`status-light status-light--${feedState}`} aria-hidden="true" />
        {statusCopy}
      </p>

      {feedState === "loading" ? (
        <div className="github-loading" aria-hidden="true">
          <span>30OZSTEAK / REPOSITORIES</span>
          <span>REQUESTING PUBLIC WORK</span>
          <span>•••</span>
        </div>
      ) : (
        <ol className="github-list">
          {repos.map((repo, index) => (
            <li key={repo.id}>
              <a className="github-row" href={repo.html_url}>
                <span className="row-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="github-copy">
                  <strong>{repo.name}</strong>
                  <span>{repo.description || "PUBLIC REPOSITORY / NO DESCRIPTION"}</span>
                </span>
                <span className="github-meta">
                  <span>{repo.language || "CODE"}</span>
                  {repo.stargazers_count > 0 ? (
                    <span>{repo.stargazers_count} ★</span>
                  ) : null}
                  {repo.updated_at ? (
                    <time dateTime={repo.updated_at}>
                      UPDATED {formatDate(repo.updated_at)}
                    </time>
                  ) : (
                    <span>PUBLIC</span>
                  )}
                </span>
                <span className="row-action">SOURCE ↗</span>
              </a>
            </li>
          ))}
        </ol>
      )}

      <a className="github-all" href="https://github.com/30ozSteak?tab=repositories">
        VIEW THE WHOLE MESS ON GITHUB <span aria-hidden="true">↗</span>
      </a>
    </div>
  );
}
