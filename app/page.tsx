import { Suspense } from "react";
import { PortalAtmosphere } from "./components/PortalAtmosphere";
import {
  PortalDirectory,
  type PortalDestination,
} from "./components/PortalDirectory";
import { PartySwitchboard } from "./components/PartyHouse";
import { getGithubRepos } from "./lib/githubServer";
import {
  addMediumPostSlugs,
  getMediumPosts,
  MEDIUM_PROFILE_URL,
} from "./lib/medium";

const GITHUB_PROFILE_URL = "https://github.com/30ozSteak";

const dateFormatter = new Intl.DateTimeFormat("en", {
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function formatDate(value: string): string {
  return dateFormatter.format(new Date(value)).toUpperCase();
}

const fallbackDestinations: PortalDestination[] = [
  {
    href: GITHUB_PROFILE_URL,
    label: "GITHUB",
    preview: {
      label: "ALL REPOS",
      meta: "PUBLIC CODE / WORKING ARCHIVE",
    },
    previewLabel: "RECENT REPOSITORIES",
    room: "code",
    source: "github",
  },
  {
    href: MEDIUM_PROFILE_URL,
    label: "MEDIUM",
    preview: {
      label: "RECENT WRITING",
      meta: "NOTES / DISPATCHES",
    },
    previewLabel: "RECENT POSTS",
    room: "writing",
    source: "medium",
  },
];

function PreviewItem({
  preview,
}: {
  preview: PortalDestination["preview"];
}) {
  return (
    <div className="portal-preview-item">
      <strong>{preview.label}</strong>
      <span>{preview.meta}</span>
    </div>
  );
}

async function RecentGithubPreviews() {
  const repos = await getGithubRepos();
  const recentRepos = repos
    .filter((repo) => !repo.archived && !repo.disabled)
    .slice(0, 3);

  if (recentRepos.length === 0) {
    return <PreviewItem preview={fallbackDestinations[0].preview} />;
  }

  return (
    <ol className="portal-preview-list">
      {recentRepos.map((repo) => (
        <li key={repo.id}>
          <div className="portal-preview-item">
            <strong>{repo.name}</strong>
            <span>
              {repo.language ?? "CODE"} · UPDATED {formatDate(repo.updated_at)}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

async function RecentMediumPreviews() {
  const recentPosts = addMediumPostSlugs(await getMediumPosts()).slice(0, 3);

  if (recentPosts.length === 0) {
    return <PreviewItem preview={fallbackDestinations[1].preview} />;
  }

  return (
    <ol className="portal-preview-list">
      {recentPosts.map((post) => (
        <li key={post.id}>
          <div className="portal-preview-item">
            <strong>{post.title}</strong>
            <span>PUBLISHED {formatDate(post.publishedAt)}</span>
          </div>
        </li>
      ))}
    </ol>
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
          <PartySwitchboard surface="home" />
        </header>

        <PortalDirectory
          destinations={fallbackDestinations}
          previews={[
            <Suspense
              fallback={
                <PreviewItem preview={fallbackDestinations[0].preview} />
              }
              key="github"
            >
              <RecentGithubPreviews />
            </Suspense>,
            <Suspense
              fallback={
                <PreviewItem preview={fallbackDestinations[1].preview} />
              }
              key="medium"
            >
              <RecentMediumPreviews />
            </Suspense>,
          ]}
        />

        <footer className="portal-footer">
          <span>DENVER</span>
          <span aria-hidden="true">/</span>
          <a href="mailto:hello@mistakes.party">HELLO@MISTAKES.PARTY</a>
        </footer>
      </main>
    </>
  );
}
