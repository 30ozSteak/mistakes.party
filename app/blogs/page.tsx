import type { Metadata } from "next";
import Link from "next/link";
import { ArrowIcon } from "../components/ArrowIcon";
import { BlogPostList } from "../components/BlogPostList";
import { SiteHeader } from "../components/SiteHeader";
import { blogPosts, profiles } from "../data";

export const metadata: Metadata = {
  title: "Blogs — MISTAKES.PARTY",
  description: "Writing and updates selected by Mistakes.party.",
};

export default function BlogsPage() {
  return (
    <>
      <a className="skip-link" href="#blog-content">
        SKIP TO THE BLOGS
      </a>
      <SiteHeader currentPage="blogs" />

      <main className="blogs-page" id="blog-content">
        <header className="blogs-hero">
          <h1>BLOGS</h1>
          <a className="blogs-source mono-label" href={profiles.medium}>
            READ ON MEDIUM <ArrowIcon />
          </a>
        </header>

        <section className="blogs-index" aria-label="Published posts">
          <BlogPostList headingLevel="h2" posts={blogPosts} />
        </section>
      </main>

      <footer className="site-footer">
        <span>MISTAKES.PARTY © 2026</span>
        <Link href="/">
          BACK TO THE INDEX <ArrowIcon direction="up" />
        </Link>
      </footer>
    </>
  );
}
