import assert from "node:assert/strict";
import test from "node:test";
import {
  getMediumPosts,
  parseMediumFeed,
} from "../app/lib/medium.ts";
import { mediumFeedFixture } from "./medium-feed-fixture.mjs";

test("normalizes, sorts, and deduplicates Medium RSS posts", () => {
  const posts = parseMediumFeed(mediumFeedFixture);

  assert.equal(posts.length, 6);
  assert.equal(posts[0].title, "MEDIUM POST 01");
  assert.equal(posts[5].title, "MEDIUM POST 06");
  assert.equal(
    posts[0].url,
    "https://medium.com/@30ozsteak/medium-post-01",
  );
  assert.ok(Date.parse(posts[0].publishedAt) > Date.parse(posts[5].publishedAt));

  const duplicated = mediumFeedFixture.replace(
    "</channel>",
    mediumFeedFixture.match(/<item>[\s\S]*?<\/item>/)?.[0] + "</channel>",
  );
  assert.equal(parseMediumFeed(duplicated).length, 6);
});

test("rejects malformed feeds and non-Medium story links", () => {
  assert.deepEqual(parseMediumFeed("<not-rss />"), []);
  assert.deepEqual(
    parseMediumFeed(
      mediumFeedFixture.replace(
        "https://medium.com/@30ozsteak/medium-post-01?source=rss#story",
        "https://example.com/not-medium",
      ),
    ).map((post) => post.title),
    [
      "MEDIUM POST 02",
      "MEDIUM POST 03",
      "MEDIUM POST 04",
      "MEDIUM POST 05",
      "MEDIUM POST 06",
    ],
  );
});

test("handles successful, unavailable, and oversized feed responses", async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/feed") {
      return new Response(mediumFeedFixture, {
        headers: { "content-type": "application/rss+xml" },
      });
    }

    if (url.pathname === "/oversized") {
      return new Response("too large", {
        headers: {
          "content-length": "2000001",
          "content-type": "application/rss+xml",
        },
      });
    }

    return new Response("Unavailable", { status: 503 });
  };

  assert.equal((await getMediumPosts("https://fixture.test/feed")).length, 6);
  assert.deepEqual(
    await getMediumPosts("https://fixture.test/unavailable"),
    [],
  );
  assert.deepEqual(
    await getMediumPosts("https://fixture.test/oversized"),
    [],
  );
});
