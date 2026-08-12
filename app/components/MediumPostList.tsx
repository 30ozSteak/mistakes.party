import type { MediumPost } from "../lib/medium";
import { MEDIUM_PROFILE_URL } from "../lib/medium";

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

  if (posts.length === 0) {
    return (
      <div className="index-list">
        <article className="index-row medium-post-row">
          <a className="index-main" href={MEDIUM_PROFILE_URL}>
            <Heading className="index-title">READ ON MEDIUM</Heading>
          </a>
          <span className="index-meta">MEDIUM / @30OZSTEAK</span>
          <span aria-hidden="true" className="index-action">
            OPEN ↗
          </span>
        </article>
      </div>
    );
  }

  return (
    <div className="index-list">
      {posts.map((post) => (
        <article className="index-row medium-post-row" data-medium-post key={post.id}>
          <a className="index-main" href={post.url}>
            <Heading className="index-title">{post.title}</Heading>
          </a>
          <span className="index-meta">
            MEDIUM ·{" "}
            <time dateTime={post.publishedAt}>{formatDate(post.publishedAt)}</time>
          </span>
          <span aria-hidden="true" className="index-action">
            READ ↗
          </span>
        </article>
      ))}
    </div>
  );
}
