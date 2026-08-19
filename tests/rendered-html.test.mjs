import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const testBaseUrl = process.env.TEST_BASE_URL;

if (!testBaseUrl) throw new Error("TEST_BASE_URL is required");

async function readRenderedPage(pathname) {
  const response = await fetch(new URL(pathname, testBaseUrl), {
    headers: { accept: "text/html" },
  });
  assert.equal(response.status, 200);
  return { headers: response.headers, html: await response.text() };
}

async function readRedirect(pathname) {
  return fetch(new URL(pathname, testBaseUrl), {
    headers: { accept: "text/html" },
    redirect: "manual",
  });
}

function assertSecurityHeaders(headers) {
  const policy = headers.get("content-security-policy") ?? "";
  assert.match(policy, /(?:^|; )default-src 'self'(?:;|$)/);
  assert.match(policy, /(?:^|; )script-src 'self' 'unsafe-inline'(?:;|$)/);
  assert.match(policy, /(?:^|; )script-src-attr 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )object-src 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )form-action 'self'(?:;|$)/);
  assert.doesNotMatch(policy, /mistakes-party-drawing-realtime|wss:/);
  assert.doesNotMatch(policy, /'nonce-/);
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("x-powered-by"), null);
}

function assertNoPartyRuntime(html) {
  assert.doesNotMatch(html, /data-testid="party-/);
  assert.doesNotMatch(html, /PartyHouse|WebSocket|balloon/i);
  assert.doesNotMatch(html, /ROOM OPEN|LIGHTS? (?:ON|HERE)/);
}

test("renders the static index with native disclosures and one ambient SVG", async () => {
  const { headers, html } = await readRenderedPage("/");
  assertSecurityHeaders(headers);
  assertNoPartyRuntime(html);

  assert.match(html, /<title>MXP — Mistakes\.party<\/title>/i);
  assert.match(html, /<h1>MISTAKES\.PARTY<\/h1>/);
  assert.equal((html.match(/data-portal-section=/g) || []).length, 5);
  assert.equal((html.match(/<details name="portal-directory">/g) || []).length, 5);
  assert.equal((html.match(/class="portal-link"/g) || []).length, 5);
  assert.match(html, /data-testid="ambient-blob"/);
  assert.match(html, /class="portal-frost"/);
  assert.equal((html.match(/data-testid="ambient-blob"/g) || []).length, 1);
  assert.doesNotMatch(html, /<canvas\b/i);
  assert.doesNotMatch(html, /use client|portal-lava-blob/);
  assert.match(html, /href="\/code"/);
  assert.match(html, /href="https:\/\/steaks\.itch\.io"/);
  assert.match(html, /BLOG \(DOGS\)/);
  assert.match(html, /BLOG \(DEV\)/);
  assert.match(html, /COLORADO/);
});

test("protects the Patreon room on the server", async () => {
  const { headers, html } = await readRenderedPage("/patreon/");
  assertSecurityHeaders(headers);
  assertNoPartyRuntime(html);
  assert.match(html, /<h1>THE DOOR<\/h1>/);
  assert.match(html, /type="password"/);
  assert.doesNotMatch(html, /PRIVATE SIGNAL 01|THE DOOR WORKS/);

  const protectedResponse = await readRedirect("/patreon/room/");
  assert.ok([303, 307, 308].includes(protectedResponse.status));
  assert.match(
    protectedResponse.headers.get("location") ?? "",
    /\/patreon\/?\?returnTo=%2Fpatreon%2Froom$/,
  );
});

test("renders local project and blog content without remote feeds", async () => {
  const blogs = await readRenderedPage("/blogs/");
  assertSecurityHeaders(blogs.headers);
  assert.match(blogs.html, /<h1>BLOGS<\/h1>/);
  assert.match(blogs.html, /NO POSTS LISTED YET\./);

  const code = await readRenderedPage("/code/");
  assertSecurityHeaders(code.headers);
  assert.match(code.html, /<h1>PROJECTS<\/h1>/);
  assert.equal((code.html.match(/<a\b[^>]*data-project/g) || []).length, 3);

  for (const [slug, title] of [
    ["mistakes-party", "THIS INDEX"],
    ["lighthouse-checker", "LIGHTHOUSE CHECKER"],
    ["itadw", "ITADW"],
  ]) {
    const page = await readRenderedPage(`/work/${slug}/`);
    assert.match(page.html, new RegExp(`<h1>${title}<\\/h1>`));
    assert.match(page.html, /CONTEXT/);
    assert.match(page.html, /THE MOVE/);
    assert.match(page.html, /OUTCOME/);
  }
});

test("keeps archive redirects", async () => {
  const archive = await readRedirect("/archive/applause-button/");
  assert.ok([303, 307, 308].includes(archive.status));
  assert.equal(
    archive.headers.get("location"),
    "https://github.com/30ozSteak/applause-button",
  );
});

test("the atmosphere is CSS-only, slow, and motion-safe", async () => {
  const styles = await readFile(new URL("app/globals.css", projectRoot), "utf8");
  assert.match(styles, /\.portal-blob\s*\{[^}]*color:\s*var\(--acid\)/s);
  assert.match(styles, /portal-blob-drift 190s/);
  assert.match(styles, /portal-blob-morph 137s/);
  assert.match(styles, /portal-blob-color 260s/);
  assert.match(styles, /\.portal-frost\s*\{[^}]*backdrop-filter:/s);
  assert.match(styles, /@keyframes portal-blob-color\s*\{/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(styles, /--party-|party-house|balloon/i);
});
