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

async function readRedirect(pathname) {
  return fetch(new URL(pathname, testBaseUrl), {
    headers: { accept: "text/html" },
    redirect: "manual",
  });
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
  assert.match(policy, /(?:^|; )style-src-attr 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )object-src 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )base-uri 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )frame-ancestors 'none'(?:;|$)/);
  assert.match(policy, /(?:^|; )form-action 'self'(?:;|$)/);
  assert.match(policy, /connect-src [^;]*https:\/\/api\.github\.com/);
  assert.match(
    policy,
    /connect-src [^;]*wss:\/\/mistakes-party-drawing-realtime\.mistakes\.workers\.dev/,
  );
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

function assertPartyPresence(html, { available = true } = {}) {
  if (available) {
    assert.match(html, /data-testid="party-house"/);
    assert.match(html, /data-testid="party-switchboard"/);
    assert.match(html, /data-testid="party-status"/);
    assert.match(html, /OPENING…/);
    assert.doesNotMatch(
      html,
      /data-testid="party-(?:presence|trigger|dialog|signal-)/,
    );
  } else {
    assert.doesNotMatch(
      html,
      /data-testid="party-(?:house|switchboard|presence)"/,
    );
  }

  assert.doesNotMatch(html, /data-testid="drawing-/);
  assert.doesNotMatch(html, /data-drawing-anchor=/);
  assert.doesNotMatch(html, /<canvas\b/i);
}

test("renders the quiet expandable external index", async () => {
  const { headers, html } = await readRenderedPage("/");

  assertPartyPresence(html);
  const nonce = assertSecurityHeaders(headers, html);
  const secondResponse = await readRenderedPage("/");
  const secondNonce = assertSecurityHeaders(
    secondResponse.headers,
    secondResponse.html,
  );
  assert.notEqual(secondNonce, nonce, "CSP nonces are never reused");

  assert.match(html, /<title>MXP — Mistakes\.party<\/title>/i);
  assert.match(html, /og\.png/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.match(html, /<h1>MISTAKES\.PARTY<\/h1>/);
  assert.match(
    html,
    /href="https:\/\/patreon\.com\/steaks">SUPPORT ↗<\/a>/,
  );
  assert.match(html, /class="skip-link" href="#elsewhere">SKIP TO THE LINKS/);
  assert.match(html, /<nav aria-label="Elsewhere"/);
  assert.equal((html.match(/data-portal-section=/g) || []).length, 3);
  assert.equal((html.match(/name="portal-sections"/g) || []).length, 3);
  assert.equal((html.match(/class="portal-link"/g) || []).length, 3);
  assert.equal((html.match(/class="portal-toggle"/g) || []).length, 3);
  assert.doesNotMatch(html, /class="portal-number"/);
  assert.doesNotMatch(html, /PUBLIC REPOS/);
  assert.doesNotMatch(html, /<details[^>]*\sopen(?:\s|>)/i);
  assert.match(html, /<summary aria-label="GITHUB" class="portal-link">/);
  assert.match(html, /<summary aria-label="MEDIUM" class="portal-link">/);
  assert.match(html, /<summary aria-label="ITCH\.IO" class="portal-link">/);
  assert.equal((html.match(/data-source-item="github"/g) || []).length, 3);
  assert.match(html, /archive-is-public/);
  assert.match(html, /fresh-repo/);
  assert.match(html, /public-fork/);
  assert.equal((html.match(/data-source-item="medium"/g) || []).length, 6);
  assert.equal((html.match(/data-source-item="itch"/g) || []).length, 5);
  assert.match(html, /UNTITLED GAME 01/);
  assert.match(html, /UNTITLED GAME 05/);
  assert.match(html, /href="https:\/\/github\.com\/30ozSteak">VIEW GITHUB ↗<\/a>/);
  assert.match(html, /href="https:\/\/medium\.com\/@30ozsteak">VIEW MEDIUM ↗<\/a>/);
  assert.match(html, /href="https:\/\/steaks\.itch\.io">VIEW ITCH\.IO ↗<\/a>/);
  assert.match(html, /DENVER/);
  assert.match(html, /href="mailto:hello@mistakes\.party">HELLO@MISTAKES\.PARTY<\/a>/);
  assert.doesNotMatch(html, /Open primary navigation|mobile-navigation/);
  assert.doesNotMatch(html, /class="(?:github-feed|medium-post-row|index-row|hero)"/);
  assert.doesNotMatch(html, /<summary[^>]*aria-label="PATREON"/i);
  assert.doesNotMatch(html, /<span aria-hidden="true">MXP<\/span>/);
  assert.doesNotMatch(html, /FOUR BAD DOORS|THE OCCASIONAL USEFUL MISTAKE/i);
  assert.doesNotMatch(html, /href="\/(?:work|archive|blogs|code)\//);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
  assert.match(
    html,
    /aria-hidden="true" class="portal-atmosphere"[^>]*data-testid="portal-atmosphere"/,
  );
});

test("renders the Patreon door without leaking member-room content", async () => {
  const { headers, html } = await readRenderedPage("/patreon/");

  assertPartyPresence(html, { available: false });
  assertSecurityHeaders(headers, html);
  assert.match(html, /<title>Patreon Access — MISTAKES\.PARTY<\/title>/i);
  assert.match(html, /name="robots" content="noindex, nofollow"/i);
  assert.match(html, /<h1>THE DOOR<\/h1>/);
  assert.match(html, /type="password"/);
  assert.match(html, /name="password"/);
  assert.match(html, /ENTER THE ROOM/);
  assert.match(
    html,
    /href="https:\/\/patreon\.com\/steaks">JOIN ON PATREON ↗<\/a>/,
  );
  assert.doesNotMatch(
    html,
    /production-test-member-password|production-test-session-secret/,
  );
  assert.doesNotMatch(
    html,
    /PRIVATE SIGNAL 01|THE DOOR WORKS|PATRON-ONLY EXPERIMENTS/,
  );

  const protectedResponse = await readRedirect("/patreon/room/");
  assert.ok(
    [303, 307, 308].includes(protectedResponse.status),
    `protected page redirects, received ${protectedResponse.status}`,
  );
  const location = protectedResponse.headers.get("location") ?? "";
  assert.match(location, /\/patreon\/?\?returnTo=%2Fpatreon%2Froom$/);
});

test("renders the complete Medium feed on the blogs page", async () => {
  const { headers, html } = await readRenderedPage("/blogs/");

  assertPartyPresence(html);
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
  assert.doesNotMatch(html, /class="index-action"/);
  assert.doesNotMatch(html, />\s*(?:SOURCE|OPEN|READ)\s*(?:↗|→)?\s*</i);
  assert.doesNotMatch(html, /content:encoded|post\.clientViewed/i);
});

test("renders internal source detail pages with prominent external CTAs", async () => {
  const archive = await readRenderedPage("/archive/applause-button/");
  assertPartyPresence(archive.html);
  assertSecurityHeaders(archive.headers, archive.html);
  assert.match(archive.html, /<title>APPLAUSE BUTTON — MISTAKES\.PARTY<\/title>/i);
  assert.match(archive.html, /<h1>APPLAUSE BUTTON<\/h1>/);
  assert.match(archive.html, /FOLLOW THE SOURCE/);
  assert.match(
    archive.html,
    /href="https:\/\/github\.com\/30ozSteak\/applause-button">VIEW ON GITHUB ↗<\/a>/,
  );

  const code = await readRenderedPage("/code/");
  assertPartyPresence(code.html);
  assertSecurityHeaders(code.headers, code.html);
  assert.match(code.html, /<title>Public Code — MISTAKES\.PARTY<\/title>/i);
  assert.match(code.html, /<h1>ALL REPOS<\/h1>/);
  assert.match(
    code.html,
    /href="https:\/\/github\.com\/30ozSteak\?tab=repositories">BROWSE GITHUB ↗<\/a>/,
  );
});

test("renders a Medium fixture detail page with its authoritative source CTA", async () => {
  const { headers, html } = await readRenderedPage("/blogs/medium-post-01/");

  assertPartyPresence(html);
  assertSecurityHeaders(headers, html);
  assert.match(html, /<title>MEDIUM POST 01 — MISTAKES\.PARTY<\/title>/i);
  assert.match(html, /<h1>MEDIUM POST 01<\/h1>/);
  assert.match(
    html,
    /href="https:\/\/medium\.com\/@30ozsteak\/medium-post-01">READ ON MEDIUM ↗<\/a>/,
  );
  assert.doesNotMatch(
    html,
    /<script>globalThis\.__mediumXssExecuted=1<\/script>/,
  );
});

test("ships the custom display font and viewport-contained disclosure portal", async () => {
  const details = await stat(
    new URL("public/fonts/kill-the-noise.otf", projectRoot),
  );
  assert.ok(details.size > 0, "custom hero font is empty");
  assert.ok(details.size < 100_000, "custom hero font is unexpectedly large");

  const styles = await readFile(
    new URL("app/globals.css", projectRoot),
    "utf8",
  );
  assert.match(
    styles,
    /\.portal-atmosphere-field::before\s*\{[^}]*radial-gradient/s,
  );
  assert.match(
    styles,
    /\.portal-atmosphere-glass\s*\{[^}]*backdrop-filter:\s*blur\(30px\)/s,
  );
  assert.match(
    styles,
    /@keyframes portal-spectrum-turn\s*\{[^}]*rotate\(-9deg\)/s,
  );
  assert.match(
    styles,
    /\.portal-atmosphere\s*\{[^}]*pointer-events:\s*none/s,
  );
  assert.match(
    styles,
    /\.portal-home\s*\{[^}]*min-height:\s*100vh;[^}]*min-height:\s*100dvh;[^}]*grid-template-rows:\s*auto minmax\(min-content, 1fr\) auto;[^}]*overflow:\s*clip;/s,
  );
  assert.doesNotMatch(styles, /\.portal-link(?::[^\s,{]+)?::before/);
  assert.match(styles, /\.portal-toggle::before\s*\{[^}]*width:\s*100%/s);
  assert.match(styles, /\.portal-toggle::after\s*\{[^}]*height:\s*100%/s);
  assert.match(styles, /\.portal-section\[open\] \.portal-toggle::after/);
  assert.match(
    styles,
    /\.portal-home a,\s*\.portal-home summary\s*\{[^}]*-webkit-tap-highlight-color:\s*transparent/s,
  );
  assert.match(
    styles,
    /\.portal-home :focus-visible\s*\{[^}]*box-shadow:\s*none/s,
  );
  assert.doesNotMatch(
    styles,
    /\.portal-link:hover\s*\{[^}]*background:\s*var\(--acid\)/s,
  );
  assert.doesNotMatch(
    styles,
    /\.portal-index\s*>\s*li\s*>\s*a:hover[^{}]*\{[^}]*background:\s*var\(--acid\)/s,
  );
  for (const [, selector, declarations] of styles.matchAll(
    /([^{}]*(?::hover|:focus-visible|:active|\[open\])[^{}]*)\{([^{}]*)\}/g,
  )) {
    if (!/\.portal-(?:masthead|section|link|panel-heading|index|footer)/.test(selector)) {
      continue;
    }
    assert.doesNotMatch(
      declarations,
      /(?:background|text-decoration-color|box-shadow)\s*:[^;]*var\(--acid\)/,
      `portal interaction state must stay acid-free: ${selector.trim()}`,
    );
  }
});

test("renders every internal project page", async () => {
  const pages = [
    ["mistakes-party", "THIS INDEX"],
    ["lighthouse-checker", "LIGHTHOUSE CHECKER"],
    ["itadw", "ITADW"],
  ];

  for (const [slug, title] of pages) {
    const { headers, html } = await readRenderedPage(`/work/${slug}/`);

    assertPartyPresence(html);
    assertSecurityHeaders(headers, html);

    assert.match(html, new RegExp(title));
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    assert.match(html, /MISTAKES\.PARTY © 2026/);
    assert.match(html, /href="\/blogs\/">BLOGS<\/a>/);
    assert.match(html, /href="\/patreon\/room\/">MEMBERS<\/a>/);
    assert.match(html, /href="https:\/\/github\.com\/30ozSteak">GITHUB ↗<\/a>/);
    assert.match(html, /CONTEXT/);
    assert.match(html, /THE MOVE/);
    assert.match(html, /OUTCOME/);
    assert.match(html, /NEXT/);
    assert.match(html, /VIEW ON GITHUB ↗/);
    assert.doesNotMatch(html, />SOURCE ↗<\/a>/);
  }
});
