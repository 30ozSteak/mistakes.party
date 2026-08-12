import assert from "node:assert/strict";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("dist/server/index.js", templateRoot);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
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
}

test("server-renders the portfolio index", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>MISTAKES\.PARTY — Nick makes things<\/title>/i);
  assert.match(html, /MISTAKES/);
  assert.match(html, /DOT PARTY/);
  assert.match(html, /WORK THAT LEFT A MARK/);
  assert.match(html, /CONTACTING GITHUB/);
  assert.match(html, /SAY HELLO/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});

test("server-renders an internal project page", async () => {
  const response = await render("/work/mistakes-party");
  assert.equal(response.status, 200);

  const html = await response.text();
  assert.match(html, /MISTAKES\.PARTY/);
  assert.match(html, /CONTEXT/);
  assert.match(html, /THE MOVE/);
  assert.match(html, /OUTCOME/);
  assert.match(html, /NEXT/);
});
