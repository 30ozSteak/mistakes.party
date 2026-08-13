import Link from "next/link";
import type { MediumPost } from "../lib/medium";
import { addMediumPostSlugs } from "../lib/medium";

type MediumPostListProps = {
  headingLevel: "h2" | "h4";
  posts: MediumPost[];
};

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
  year: "numeric",
});

function formatDate(value: string) {
  return dateFormatter.format(new Date(value)).toUpperCase();
}

export function MediumPostList({
  headingLevel,
  posts,
}: MediumPostListProps) {
  const Heading = headingLevel;
  const routedPosts = addMediumPostSlugs(posts);

  if (routedPosts.length === 0) {
    return (
      <p className="medium-feed-empty mono-label" role="status">
        RECENT POSTS ARE UNAVAILABLE.
      </p>
    );
  }

  return (
    <div className="index-list">
      {routedPosts.map((post) => (
        <Link
          aria-label={post.title}
          className="index-row medium-post-row"
          data-medium-post
          href={`/blogs/${post.slug}`}
          key={post.id}
        >
          <div className="index-main">
            <Heading className="index-title">{post.title}</Heading>
          </div>
          <span className="index-meta">
            MEDIUM ·{" "}
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          </span>
        </Link>
      ))}
    </div>
  );
}
