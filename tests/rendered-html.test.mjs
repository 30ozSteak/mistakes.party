import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);
const testBaseUrl = process.env.TEST_BASE_URL;

if (!testBaseUrl) {
  throw new Error("TEST_BASE_URL is required for rendered HTML tests");
}

async function readRenderedPage(pathname) {
  const response = await fetch(new URL(pathname, testBaseUrl), {
    headers: { accept: "text/html" },
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return {
    headers: response.headers,
    html: await response.text(),
  };
}

function assertSecurityHeaders(headers, html) {
  const policy = headers.get("content-security-policy") ?? "";
  const nonce = policy.match(/'nonce-([a-f0-9]{32})'/)?.[1];

  assert.ok(nonce, "CSP contains a fresh 128-bit nonce");
  assert.match(policy, /(?:^|; )default-src 'self'(?:;|$)/);
  assert.match(
    policy,
    new RegExp(`(?:^|; )script-src 'self' 'nonce-${nonce}'(?:;|$)`),
  );
  assert.doesNotMatch(policy, /(?:^|; )script-src [^;]*'strict-dynamic'/);
  assert.doesNotMatch(policy, /(?:^|; )script-src [^;]*'unsafe-inline'/);
  assert.doesNotMatch(policy, /(?:^|; )script-src [^;]*'unsafe-eval'/);
  assert.match(policy, /(?:^|; )script-src-attr 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )object-src 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )base-uri 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )form-action 'self'(?:;|$)/);
  assert.match(policy, /connect-src [^;]*https:\/\/api\.github\.com/);
  assert.match(policy, /(?:^|; )upgrade-insecure-requests(?:;|$)/);

  const scripts = [...html.matchAll(/<script\b[^>]*>/gi)].map(
    ([script]) => script,
  );
  assert.ok(scripts.length > 0, "Next rendered executable scripts");
  for (const script of scripts) {
    assert.match(script, new RegExp(`\\snonce="${nonce}"(?:\\s|>)`));
  }

  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(
    headers.get("referrer-policy"),
    "strict-origin-when-cross-origin",
  );
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(
    headers.get("permissions-policy"),
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  assert.equal(headers.get("x-powered-by"), null);

  return nonce;
}

function assertDrawingPlayground(html) {
  assert.match(html, /data-testid="drawing-playground"/);
  assert.match(html, /data-testid="drawing-canvas"/);
  assert.match(html, /data-testid="drawing-toolbar"/);
  assert.match(html, /data-testid="drawing-toggle"/);
  assert.match(html, /aria-pressed="false"/);
  assert.match(html, /aria-label="Highlighter color"/);
  assert.match(html, /data-testid="drawing-color-acid"/);
  assert.match(html, /data-testid="drawing-color-pink"/);
  assert.match(html, /data-testid="drawing-color-cyan"/);
  assert.match(html, /data-testid="drawing-color-orange"/);
  assert.match(html, /data-testid="party-start"/);
  assert.match(html, />START PARTY<\/button>/);
}

test("renders the portfolio index", async () => {
  const { headers, html } = await readRenderedPage("/");

  assertDrawingPlayground(html);
  const nonce = assertSecurityHeaders(headers, html);
  const secondResponse = await readRenderedPage("/");
  const secondNonce = assertSecurityHeaders(
    secondResponse.headers,
    secondResponse.html,
  );
  assert.notEqual(secondNonce, nonce, "CSP nonces are never reused");

  assert.match(html, /<title>MXP — Mistakes\.party<\/title>/i);
  assert.match(html, /og-mxp\.png/);
  assert.match(html, /aria-label="MXP — Mistakes dot party"/);
  assert.match(html, /class="mxp" aria-hidden="true"/);
  assert.match(html, /class="mxp-x">X<\/span>/);
  assert.match(html, /THE OCCASIONAL USEFUL MISTAKE/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.match(html, /class="skip-link" href="#work">SKIP TO THE WORK/);
  assert.match(html, /href="#work">WORK<\/a>/);
  assert.match(html, /href="\/blogs\/">BLOGS<\/a>/);
  assert.match(html, /href="#github">GITHUB<\/a>/);
  assert.match(html, /href="#about">ABOUT<\/a>/);
  assert.match(html, /aria-label="Open primary navigation"/);
  assert.match(html, /aria-controls="mobile-navigation"/);
  assert.match(html, /aria-expanded="false"/);
  assert.match(html, /aria-hidden="true"[^>]*id="mobile-navigation" inert=""/);
  assert.match(html, /aria-label="Mobile navigation"/);
  assert.match(html, /id="work"/);
  assert.match(html, /id="github"/);
  assert.match(html, /id="about"/);
  assert.match(html, /class="sr-only" role="status" aria-live="polite"/);
  assert.match(html, /class="github-feed" aria-busy="true"/);
  assert.doesNotMatch(html, /class="github-status"/);
  assert.equal((html.match(/href="\/work\//g) || []).length, 3);
  assert.equal((html.match(/aria-label="View source for /g) || []).length, 3);
  assert.doesNotMatch(
    html,
    /\bNICK\b|\bSTEAKS\b|\bWEIRD\b|WORK THAT LEFT A MARK|THE GITHUB WIRE|KEEP CLICKING|MAKE IT USEFUL\. MAKE IT LOUD/i,
  );
  assert.doesNotMatch(html, /class="section-heading|class="section-number/);
  assert.doesNotMatch(html, /class="index-description"/);
  assert.match(html, />WEBSITES<\/h3>/);
  assert.match(html, />TOOLS<\/h3>/);
  assert.match(html, />EXPERIMENTS<\/h3>/);
  assert.match(html, />BLOGS<\/h3>/);
  assert.match(html, />PUBLIC CODE<\/h3>/);
  assert.match(html, />ELSEWHERE<\/h3>/);
  assert.match(html, /GITHUB \/ SOURCE/);
  assert.match(html, /Loading GitHub repositories/);
  assert.equal((html.match(/data-medium-post=/g) || []).length, 5);
  assert.match(html, /MEDIUM POST 01/);
  assert.doesNotMatch(html, /MEDIUM POST 06/);
  assert.doesNotMatch(
    html,
    /<script>globalThis\.__mediumXssExecuted=1<\/script>/,
  );
  assert.match(
    html,
    /&lt;\/script&gt;&lt;script&gt;globalThis\.__mediumXssExecuted=1&lt;\/script&gt;/,
  );
  assert.match(
    html,
    /class="index-main" href="\/blogs\/"><h4 class="index-title">ALL BLOGS<\/h4>/,
  );
  assert.match(html, /MISTAKES\.PARTY IS A DENVER HOME/);
  assert.match(html, /SAY HELLO/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("renders the complete Medium feed on the blogs page", async () => {
  const { headers, html } = await readRenderedPage("/blogs/");

  assertDrawingPlayground(html);
  assertSecurityHeaders(headers, html);

  assert.match(html, /<title>Blogs — MISTAKES\.PARTY<\/title>/i);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.match(html, /<h1>BLOGS<\/h1>/);
  assert.equal((html.match(/data-medium-post=/g) || []).length, 6);
  assert.match(html, /MEDIUM POST 01/);
  assert.match(html, /MEDIUM POST 06/);
  assert.doesNotMatch(
    html,
    /<script>globalThis\.__mediumXssExecuted=1<\/script>/,
  );
  assert.match(
    html,
    /&lt;\/script&gt;&lt;script&gt;globalThis\.__mediumXssExecuted=1&lt;\/script&gt;/,
  );
  assert.match(html, /aria-current="page" href="\/blogs\/">BLOGS<\/a>/);
  assert.match(html, /READ ON MEDIUM ↗/);
  assert.doesNotMatch(html, /content:encoded|post\.clientViewed/i);
});

test("ships the custom MXP hero font", async () => {
  const details = await stat(
    new URL("public/fonts/kill-the-noise.otf", projectRoot),
  );
  assert.ok(details.size > 0, "custom hero font is empty");
  assert.ok(details.size < 100_000, "custom hero font is unexpectedly large");

  const styles = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );
  assert.match(styles, /\.mxp-x\s*\{[^}]*text-shadow:[^}]*var\(--acid\)/s);
  assert.match(styles, /\.mxp-x\s*\{[^}]*margin-left:\s*0\.14em/s);
  assert.doesNotMatch(styles, /\.mxp-x::after/);
});

test("renders every internal project page", async () => {
  const pages = [
    ["mistakes-party", "THIS INDEX"],
    ["lighthouse-checker", "LIGHTHOUSE CHECKER"],
    ["itadw", "ITADW"],
  ];

  for (const [slug, title] of pages) {
    const { headers, html } = await readRenderedPage(`/work/${slug}/`);

    assertDrawingPlayground(html);
    assertSecurityHeaders(headers, html);

    assert.match(html, new RegExp(title));
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    assert.match(html, /MISTAKES\.PARTY © 2026/);
    assert.match(html, /href="\/#work">WORK<\/a>/);
    assert.match(html, /href="\/blogs\/">BLOGS<\/a>/);
    assert.match(html, /href="\/#github">GITHUB<\/a>/);
    assert.match(html, /href="\/#about">ABOUT<\/a>/);
    assert.match(html, /CONTEXT/);
    assert.match(html, /THE MOVE/);
    assert.match(html, /OUTCOME/);
    assert.match(html, /NEXT/);
  }
});
