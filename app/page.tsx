import type { ReactNode } from "react";
import { ArrowIcon } from "./components/ArrowIcon";
import { PortalAtmosphere } from "./components/PortalAtmosphere";
import {
  PortalDirectory,
  type PortalDestination,
} from "./components/PortalDirectory";
import {
  blogPosts,
  featuredProjects,
  profiles,
  type BlogPost,
} from "./data";

const ITCH_PROFILE_URL = "https://steaks.itch.io";
const DOG_BLOG_PREVIEW = {
  label: "DOG NOTES",
  meta: "STORIES / PHOTOS / COMING SOON",
};
const DEV_BLOG_PREVIEW = {
  label: "RECENT WRITING",
  meta: "NOTES / DISPATCHES",
};

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
    href: "/code",
    label: "PROJECTS",
    preview: {
      label: "ALL PROJECTS",
      meta: "PUBLIC + PRIVATE / CURATED HERE",
    },
    previewLabel: "SELECTED PROJECTS",
    source: "projects",
  },
  {
    href: ITCH_PROFILE_URL,
    label: "GAMES",
    preview: {
      label: "ITCH.IO",
      meta: "PLAYABLE / IN PROGRESS",
    },
    previewLabel: "GAMES",
    source: "games",
  },
  {
    label: "WEBSITES",
    preview: {
      label: "WEBSITES",
      meta: "SELECTED SITES / COMING SOON",
    },
    previewLabel: "WEBSITES",
    source: "websites",
  },
  {
    label: "BLOGS",
    preview: {
      label: "DOGS + DEV",
      meta: "STORIES / NOTES / DISPATCHES",
    },
    previewLabel: "BLOG CHANNELS",
    source: "blogs",
  },
  {
    label: "SHOP",
    preview: {
      label: "SHOP",
      meta: "OBJECTS / GOODS / COMING SOON",
    },
    previewLabel: "SHOP",
    source: "shop",
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

function RecentProjectPreviews() {
  const recentProjects = featuredProjects.slice(0, 3);

  if (recentProjects.length === 0) {
    return <PreviewItem preview={fallbackDestinations[0].preview} />;
  }

  return (
    <ol className="portal-preview-list">
      {recentProjects.map((project) => (
        <li key={project.slug}>
          <a className="portal-preview-item" href={`/work/${project.slug}`}>
            <strong>{project.title}</strong>
            <span>{project.category} · {project.visibility}</span>
          </a>
        </li>
      ))}
    </ol>
  );
}

function RecentBlogPreviews() {
  const recentPosts = blogPosts.slice(0, 3);

  if (recentPosts.length === 0) {
    return <PreviewItem preview={DEV_BLOG_PREVIEW} />;
  }

  return (
    <ol className="portal-preview-list">
      {recentPosts.map((post) => (
        <li key={post.id}>
          <BlogPreviewItem post={post} />
        </li>
      ))}
    </ol>
  );
}

function BlogPreviewItem({ post }: { post: BlogPost }) {
  const content = (
    <>
      <strong>{post.title}</strong>
      <span>{post.source} · {formatDate(post.publishedAt)}</span>
    </>
  );

  return post.url ? (
    <a className="portal-preview-item" href={post.url}>
      {content}
    </a>
  ) : (
    <div className="portal-preview-item">{content}</div>
  );
}

function BlogPreviewGroups({
  devPreview,
}: {
  devPreview: ReactNode;
}) {
  return (
    <div className="portal-blog-groups">
      <section aria-label="Blog about dogs" className="portal-blog-group">
        <div className="portal-blog-heading">
          <h2>BLOG (DOGS)</h2>
        </div>
        <PreviewItem preview={DOG_BLOG_PREVIEW} />
      </section>

      <section aria-label="Development blog" className="portal-blog-group">
        <div className="portal-blog-heading">
          <h2>BLOG (DEV)</h2>
          <a className="portal-blog-source" href={profiles.medium}>
            OPEN <ArrowIcon />
          </a>
        </div>
        {devPreview}
      </section>
    </div>
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
        </header>

        <PortalDirectory
          destinations={fallbackDestinations}
          previews={[
            <RecentProjectPreviews key="projects" />,
            null,
            null,
            <BlogPreviewGroups
              devPreview={<RecentBlogPreviews />}
              key="blogs"
            />,
            null,
          ]}
        />

        <footer className="portal-footer">
          <span>COLORADO</span>
          <span aria-hidden="true">/</span>
          <a href="mailto:hello@mistakes.party">HELLO@MISTAKES.PARTY</a>
        </footer>
      </main>
    </>
  );
}
