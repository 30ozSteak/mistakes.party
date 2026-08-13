# MXP / MISTAKES.PARTY

A loud, text-first portfolio for websites, apps, games, art, code, and useful
mistakes.

## Local development

Requires Node.js 22.

```bash
npm install
npm run dev
```

The production drawing relay is the default. It provides anonymous, route-local
presence and ephemeral public drawing pods in addition to private invite rooms.
To run the realtime service locally instead, start both processes with a
matching public URL:

```bash
npm run dev:realtime -- --port 8787
NEXT_PUBLIC_DRAWING_REALTIME_URL=http://127.0.0.1:8787 npm run dev -- --port 3000
```

## Production build

```bash
npm run lint
npm test
```

The browser interaction suite uses Playwright:

```bash
npx playwright install chromium
npm run test:e2e
```

The Next.js site deploys to Vercel from `main`. The realtime drawing service is
a separate Cloudflare Worker backed by Durable Objects and deploys with:

```bash
npm run check:realtime
npm run deploy:realtime
```

Production defaults to:

```text
https://mistakes-party-drawing-realtime.mistakes.workers.dev
```

`NEXT_PUBLIC_DRAWING_REALTIME_URL` remains available as a build-time override
for local development or another relay. The Worker production origin allowlist
must contain the exact website origin (`https://www.mistakes.party`).

Public drawing has two production controls in `worker/wrangler.jsonc`:

- `PUBLIC_DRAWING_MODE=off|presence|live` is the server-authoritative kill
  switch. `presence` keeps the per-page session count but disables public pods;
  `off` disables the public layer. Private invite rooms remain available.
- `PUBLIC_DRAWING_GENERATION` partitions all public lobbies and pods. Increment
  it only when an emergency purge of ephemeral public state is intended.

Deploy Worker changes before a client that depends on them. For this v2
rollout, deploy with Public mode off, smoke-test `/v1/rooms` and both `/v2`
WebSocket endpoints from the production origin, deploy the site, then change
the Worker to `live`. See [worker/README.md](worker/README.md) for the protocol,
capacity, retention, and deployment details.

Solo artwork remains in that browser's IndexedDB and is never uploaded. Public
pod artwork lives only in the Worker for its short afterglow, while private
party artwork continues to use the original invite-room lifecycle.

The homepage and blog index use Incremental Static Regeneration to refresh the
Medium feed every 15 minutes. The portfolio also loads public repositories from
GitHub and falls back safely when either upstream feed is unavailable.
