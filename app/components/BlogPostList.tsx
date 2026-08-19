import type { BlogPost } from "../data";

type BlogPostListProps = {
  headingLevel: "h2" | "h4";
  posts: readonly BlogPost[];
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

export function BlogPostList({ headingLevel, posts }: BlogPostListProps) {
  const Heading = headingLevel;

  if (posts.length === 0) {
    return (
      <p className="blog-feed-empty mono-label" role="status">
        NO POSTS LISTED YET.
      </p>
    );
  }

  return (
    <div className="index-list">
      {posts.map((post) => {
        const content = (
          <>
            <div className="index-main">
              <Heading className="index-title">{post.title}</Heading>
            </div>
            <span className="index-meta">
              {post.source} ·{" "}
              <time dateTime={post.publishedAt}>
                {formatDate(post.publishedAt)}
              </time>
            </span>
          </>
        );

        return post.url ? (
          <a
            aria-label={post.title}
            className="index-row blog-post-row"
            data-blog-post
            href={post.url}
            key={post.id}
          >
            {content}
          </a>
        ) : (
          <article
            className="index-row blog-post-row"
            data-blog-post
            key={post.id}
          >
            {content}
          </article>
        );
      })}
    </div>
  );
}
