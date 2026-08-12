"use client";

import { useEffect, useState } from "react";
import {
  parseGithubRepoCache,
  parseGithubRepos,
  type GithubRepo,
} from "../lib/github";

type FeedState = "loading" | "live" | "cached" | "fallback";

const CACHE_KEY = "mistakes-party.github.v3";
const INDEXED_REPOS = new Set(["lighthouse-checker", "itadw"]);

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
        const cachedRepos = parseGithubRepoCache(cached);
        if (cachedRepos) {
          setRepos(cachedRepos);
          setFeedState("cached");
          return;
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
        const publicRepos = parseGithubRepos(payload)
          .filter((repo) => !repo.fork && !repo.archived && !repo.disabled)
          .filter((repo) => !INDEXED_REPOS.has(repo.name.toLowerCase()))
          .sort(
            (a, b) =>
              new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
          )
          .slice(0, 2);

        if (publicRepos.length === 0) throw new Error("No public repositories");

        setRepos(publicRepos);
        setFeedState("live");
        window.localStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ savedAt: Date.now(), repos: publicRepos }),
        );
      } catch {
        setRepos([]);
        setFeedState("fallback");
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

  const statusCopy =
    feedState === "loading"
      ? "Loading GitHub repositories."
      : feedState === "fallback"
        ? "Recent GitHub repositories are unavailable."
        : "GitHub repositories loaded.";

  return (
    <div className="github-feed" aria-busy={feedState === "loading"}>
      <p className="sr-only" role="status" aria-live="polite">
        {statusCopy}
      </p>

      {feedState === "loading" ? (
        <div className="github-loading" aria-hidden="true">
          <span />
          <span />
        </div>
      ) : repos.length > 0 ? (
        <div className="index-list">
          {repos.map((repo) => (
            <article className="index-row" key={repo.id}>
              <a className="index-main" href={repo.html_url}>
                <h4 className="index-title">{repo.name}</h4>
              </a>
              <span className="index-meta">
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
              <span aria-hidden="true" className="index-action">
                SOURCE ↗
              </span>
            </article>
          ))}
        </div>
      ) : null}

      <article className="index-row">
        <a
          className="index-main"
          href="https://github.com/30ozSteak?tab=repositories"
        >
          <h4 className="index-title">ALL REPOS</h4>
        </a>
        <span className="index-meta">GITHUB / SOURCE</span>
        <span aria-hidden="true" className="index-action">
          OPEN ↗
        </span>
      </article>
    </div>
  );
}
