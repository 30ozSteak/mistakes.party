import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

const projectRoot = new URL("../", import.meta.url);

async function readExportedPage(pathname) {
  const workerUrl = new URL("dist/server/index.js", projectRoot);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  const response = await worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  return response.text();
}

test("exports the portfolio index", async () => {
  const html = await readExportedPage("/");

  assert.match(html, /<title>MXP — Mistakes\.party<\/title>/i);
  assert.match(html, /og-mxp\.png/);
  assert.match(html, /aria-label="MXP — Mistakes dot party"/);
  assert.match(html, /class="mxp" aria-hidden="true"/);
  assert.match(html, /class="mxp-x">X<\/span>/);
  assert.match(html, /THE OCCASIONAL USEFUL MISTAKE/);
  assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
  assert.match(html, /class="skip-link" href="#work">SKIP TO THE WORK/);
  assert.match(html, /href="#work">WORK<\/a>/);
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
  assert.match(html, />PUBLIC CODE<\/h3>/);
  assert.match(html, />ELSEWHERE<\/h3>/);
  assert.match(html, /GITHUB \/ SOURCE/);
  assert.match(html, /Loading GitHub repositories/);
  assert.match(html, /MISTAKES\.PARTY IS A DENVER HOME/);
  assert.match(html, /SAY HELLO/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
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
  assert.match(styles, /\.mxp-x\s*\{[^}]*margin-left:\s*0\.2em/s);
  assert.doesNotMatch(styles, /\.mxp-x::after/);
});

test("exports every internal project page", async () => {
  const pages = [
    ["mistakes-party", "THIS INDEX"],
    ["lighthouse-checker", "LIGHTHOUSE CHECKER"],
    ["itadw", "ITADW"],
  ];

  for (const [slug, title] of pages) {
    const html = await readExportedPage(`/work/${slug}/`);

    assert.match(html, new RegExp(title));
    assert.equal((html.match(/<h1[ >]/g) || []).length, 1);
    assert.match(html, /MISTAKES\.PARTY © 2026/);
    assert.match(html, /href="\/#work">WORK<\/a>/);
    assert.match(html, /href="\/#github">GITHUB<\/a>/);
    assert.match(html, /href="\/#about">ABOUT<\/a>/);
    assert.match(html, /CONTEXT/);
    assert.match(html, /THE MOVE/);
    assert.match(html, /OUTCOME/);
    assert.match(html, /NEXT/);
  }
});
