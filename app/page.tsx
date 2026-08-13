import { Suspense, type ReactNode } from "react";
import { PortalAtmosphere } from "./components/PortalAtmosphere";
import { getGithubRepos } from "./lib/githubServer";
import { getMediumPosts, MEDIUM_PROFILE_URL } from "./lib/medium";

const GITHUB_PROFILE_URL = "https://github.com/30ozSteak";
const ITCH_PROFILE_URL = "https://steaks.itch.io";
const SUPPORT_URL = "https://patreon.com/steaks";
const itchPlaceholders = Array.from(
  { length: 5 },
  (_, index) => `UNTITLED GAME ${String(index + 1).padStart(2, "0")}`,
);

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value)).toUpperCase();
}

function PortalSection({
  children,
  label,
  source,
}: {
  children: ReactNode;
  label: string;
  source: "github" | "medium" | "itch";
}) {
  return (
    <li>
      <details
        className="portal-section"
        data-portal-section={source}
        name="portal-sections"
      >
        <summary aria-label={label} className="portal-link">
          <span className="portal-name">{label}</span>
          <span aria-hidden="true" className="portal-toggle" />
        </summary>
        <div className="portal-panel">{children}</div>
      </details>
    </li>
  );
}

async function GithubIndex() {
  const githubRepos = await getGithubRepos();

  return (
    <>
      <div className="portal-panel-heading">
        <a href={GITHUB_PROFILE_URL}>VIEW GITHUB ↗</a>
      </div>
      {githubRepos.length > 0 ? (
        <ul className="portal-index" aria-label="Public GitHub repositories">
          {githubRepos.map((repo) => (
            <li data-source-item="github" key={repo.id}>
              <a href={repo.html_url}>
                <span>{repo.name}</span>
                <span className="portal-index-meta">
                  {repo.language || "CODE"}
                  {repo.stargazers_count > 0
                    ? ` · ${repo.stargazers_count} ★`
                    : ""}
                </span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="portal-empty" role="status">
          THE REPO LIST IS TEMPORARILY UNAVAILABLE.
        </p>
      )}
    </>
  );
}

async function MediumIndex() {
  const mediumPosts = await getMediumPosts();
  const latestMediumPosts = mediumPosts.slice(0, 10);

  return (
    <>
      <div className="portal-panel-heading">
        <span>LATEST {latestMediumPosts.length || "—"}</span>
        <a href={MEDIUM_PROFILE_URL}>VIEW MEDIUM ↗</a>
      </div>
      {latestMediumPosts.length > 0 ? (
        <ul className="portal-index" aria-label="Latest Medium posts">
          {latestMediumPosts.map((post) => (
            <li data-source-item="medium" key={post.id}>
              <a href={post.url}>
                <span>{post.title}</span>
                <time
                  className="portal-index-meta"
                  dateTime={post.publishedAt}
                >
                  {formatDate(post.publishedAt)}
                </time>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="portal-empty" role="status">
          RECENT POSTS ARE TEMPORARILY UNAVAILABLE.
        </p>
      )}
    </>
  );
}

function PanelLoading({ source }: { source: string }) {
  return (
    <p className="portal-loading" role="status">
      FETCHING {source}…
    </p>
  );
}

export default function Home() {
  return (
    <>
      <a className="skip-link" href="#elsewhere">
        SKIP TO THE LINKS
      </a>

      <main className="portal-home" id="content">
        <PortalAtmosphere />

        <header className="portal-masthead">
          <h1>MISTAKES.PARTY</h1>
          <a href={SUPPORT_URL}>SUPPORT ↗</a>
        </header>

        <nav
          aria-label="Elsewhere"
          className="portal-destinations"
          id="elsewhere"
        >
          <ol>
            <PortalSection label="GITHUB" source="github">
              <Suspense fallback={<PanelLoading source="GITHUB" />}>
                <GithubIndex />
              </Suspense>
            </PortalSection>

            <PortalSection label="MEDIUM" source="medium">
              <Suspense fallback={<PanelLoading source="MEDIUM" />}>
                <MediumIndex />
              </Suspense>
            </PortalSection>

            <PortalSection label="ITCH.IO" source="itch">
              <div className="portal-panel-heading">
                <span>5 GAMES / NAMES TO COME</span>
                <a href={ITCH_PROFILE_URL}>VIEW ITCH.IO ↗</a>
              </div>
              <ul
                aria-label="Games in progress"
                className="portal-index portal-index-placeholder"
              >
                {itchPlaceholders.map((game) => (
                  <li data-source-item="itch" key={game}>
                    <span>
                      <span>{game}</span>
                      <span className="portal-index-meta">IN PROGRESS</span>
                    </span>
                  </li>
                ))}
              </ul>
            </PortalSection>
          </ol>
        </nav>

        <footer className="portal-footer">
          <span>DENVER</span>
          <span aria-hidden="true">/</span>
          <a href="mailto:hello@mistakes.party">HELLO@MISTAKES.PARTY</a>
        </footer>
      </main>
    </>
  );
}
