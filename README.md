# MXP / MISTAKES.PARTY

A loud, text-first portfolio for websites, apps, games, art, code, and useful
mistakes.

## Local development

Requires Node.js 22.

```bash
npm install
npm run dev
```

The production drawing relay is the default. To run the realtime service
locally instead, start both processes with a matching public URL:

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

The homepage and blog index use Incremental Static Regeneration to refresh the
Medium feed every 15 minutes. The portfolio also loads public repositories from
GitHub and falls back safely when either upstream feed is unavailable.
