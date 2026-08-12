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

  const itemFlood = Array.from(
    { length: 75 },
    (_, index) => `<item>
      <title>POST ${index}</title>
      <link>https://medium.com/@30ozsteak/post-${index}</link>
      <guid>post-${index}</guid>
      <pubDate>Mon, 10 Aug 2026 12:00:00 GMT</pubDate>
    </item>`,
  ).join("");
  assert.equal(
    parseMediumFeed(`<rss><channel>${itemFlood}</channel></rss>`).length,
    50,
  );
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

  const entityFeed = `<?xml version="1.0"?>
    <!DOCTYPE rss [<!ENTITY injected "EXPANDED">]>
    <rss><channel><item>
      <title>&injected;</title>
      <link>https://medium.com/@30ozsteak/entity-check</link>
      <pubDate>Mon, 10 Aug 2026 12:00:00 GMT</pubDate>
    </item></channel></rss>`;
  assert.deepEqual(parseMediumFeed(entityFeed), []);

  const oversizedTitleFeed = mediumFeedFixture.replace(
    "MEDIUM POST 01",
    "X".repeat(301),
  );
  assert.equal(parseMediumFeed(oversizedTitleFeed).length, 5);
});

test("allows only trusted feed URLs and redirect destinations", async (t) => {
  const originalFetch = globalThis.fetch;
  const originalAllowLocalhost = process.env.MEDIUM_FEED_ALLOW_LOCALHOST;
  process.env.MEDIUM_FEED_ALLOW_LOCALHOST = "1";
  t.after(() => {
    globalThis.fetch = originalFetch;
    if (originalAllowLocalhost === undefined) {
      delete process.env.MEDIUM_FEED_ALLOW_LOCALHOST;
    } else {
      process.env.MEDIUM_FEED_ALLOW_LOCALHOST = originalAllowLocalhost;
    }
  });
  const fetchedUrls = [];
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    fetchedUrls.push(url.toString());
    assert.equal(init?.redirect, "manual");

    if (url.pathname === "/feed") {
      return new Response(mediumFeedFixture, {
        headers: { "content-type": "application/rss+xml" },
      });
    }

    if (url.pathname === "/redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: "/feed" },
      });
    }

    if (url.pathname === "/evil-redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://attacker.test/feed" },
      });
    }

    if (url.pathname === "/cross-medium-redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: "https://cdn-images-1.medium.com/feed" },
      });
    }

    if (url.pathname === "/loopback-redirect") {
      return new Response(null, {
        status: 302,
        headers: { location: "http://127.0.0.1:43210/feed" },
      });
    }

    return new Response("Unavailable", { status: 503 });
  };

  assert.equal((await getMediumPosts("https://medium.com/feed")).length, 6);
  assert.equal(
    (await getMediumPosts("https://medium.com/redirect")).length,
    6,
  );
  assert.deepEqual(
    await getMediumPosts("https://medium.com/evil-redirect"),
    [],
  );
  assert.equal(fetchedUrls.includes("https://attacker.test/feed"), false);
  assert.deepEqual(
    await getMediumPosts("https://medium.com/cross-medium-redirect"),
    [],
  );
  assert.equal(fetchedUrls.includes("https://cdn-images-1.medium.com/feed"), false);
  assert.deepEqual(
    await getMediumPosts("https://medium.com/loopback-redirect"),
    [],
  );
  assert.equal(fetchedUrls.includes("http://127.0.0.1:43210/feed"), false);

  assert.equal(
    (await getMediumPosts("http://127.0.0.1:43210/redirect")).length,
    6,
  );

  const callsBeforeRejectedUrls = fetchedUrls.length;
  for (const url of [
    "http://medium.com/feed",
    "https://medium.com.evil.test/feed",
    "https://user:password@medium.com/feed",
    "file:///etc/passwd",
    "not a URL",
  ]) {
    assert.deepEqual(await getMediumPosts(url), []);
  }
  assert.equal(fetchedUrls.length, callsBeforeRejectedUrls);
});

test("rejects unavailable and oversized feed bodies while streaming", async (t) => {
  const originalFetch = globalThis.fetch;
  let declaredOversizeCanceled = false;
  t.after(() => {
    globalThis.fetch = originalFetch;
  });
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));

    if (url.pathname === "/oversized") {
      return new Response(
        new ReadableStream({
          cancel() {
            declaredOversizeCanceled = true;
          },
        }),
        {
          headers: {
            "content-length": "2000001",
            "content-type": "application/rss+xml",
          },
        },
      );
    }

    if (url.pathname === "/chunked-oversized") {
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(1_000_000));
            controller.enqueue(new Uint8Array(1_000_001));
            controller.close();
          },
        }),
        { headers: { "content-type": "application/rss+xml" } },
      );
    }

    return new Response("Unavailable", { status: 503 });
  };

  assert.deepEqual(
    await getMediumPosts("https://medium.com/unavailable"),
    [],
  );
  assert.deepEqual(
    await getMediumPosts("https://medium.com/oversized"),
    [],
  );
  assert.equal(declaredOversizeCanceled, true);
  assert.deepEqual(
    await getMediumPosts("https://medium.com/chunked-oversized"),
    [],
  );
});
