import type { Metadata } from "next";
import Link from "next/link";
import { ArrowIcon } from "../components/ArrowIcon";
import { MediumPostList } from "../components/MediumPostList";
import { SiteHeader } from "../components/SiteHeader";
import { getMediumPosts, MEDIUM_PROFILE_URL } from "../lib/medium";

export const metadata: Metadata = {
  title: "Blogs — MISTAKES.PARTY",
  description: "Writing and updates from Mistakes.party, published on Medium.",
};

export const revalidate = 900;

export default async function BlogsPage() {
  const posts = await getMediumPosts();

  return (
    <>
      <a className="skip-link" href="#blog-content">
        SKIP TO THE BLOGS
      </a>
      <SiteHeader currentPage="blogs" indexLink />

      <main className="blogs-page" id="blog-content">
        <header className="blogs-hero">
          <h1>BLOGS</h1>
          <a className="blogs-source mono-label" href={MEDIUM_PROFILE_URL}>
            READ ON MEDIUM <ArrowIcon />
          </a>
        </header>

        <section className="blogs-index" aria-label="Posts from Medium">
          <MediumPostList headingLevel="h2" posts={posts} />
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
