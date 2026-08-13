# MXP / MISTAKES.PARTY

A loud, text-first portfolio for websites, apps, games, art, code, and useful
mistakes.

## Local development

Requires Node.js 22.

```bash
npm install
npm run dev
```

### Patreon member access

The member door at `/patreon/` protects `/patreon/room/` with a signed,
30-day browser grant. Configure both values locally and in Vercel:

```text
PATREON_ACCESS_PASSWORD=the-password-shared-with-patrons
PATREON_SESSION_SECRET=a-separate-random-secret-at-least-32-characters-long
```

Generate the session secret with `openssl rand -base64 32`. Keep both values
server-only—do not prefix them with `NEXT_PUBLIC_` or add them to
`next.config.ts`. Use a strong Patreon password of at least 12 characters.
Rotating either value revokes existing member grants.

Before launch, add a per-IP Vercel Firewall rate limit for the Server Action
`app/patreon/actions.ts#unlockPatreonAccess` (for example, eight attempts per
minute). Vercel documents Server Action targeting in its
[Firewall guide](https://vercel.com/changelog/manage-next-js-server-actions-in-the-vercel-firewall).
The application rejects short credentials, but a durable edge limit is still
needed to prevent distributed online guessing.

Use the server-derived flag or wrapper for individual features:

```tsx
import { PatreonOnly } from "@/app/components/PatreonOnly";
import { hasPatreonAccess } from "@/app/lib/patreonAccess";

const isPatreon = await hasPatreonAccess();

return <PatreonOnly fallback={null}>Member content</PatreonOnly>;
```

For a whole page, call `await requirePatreonAccess("/your-route")` in that
page before reading protected data. Server Actions and Route Handlers must
still call `hasPatreonAccess()` themselves; hiding a control is not an
authorization boundary. Anonymous public drawing is disabled throughout the
`/patreon/*` subtree so member pages do not share a public annotation lobby.

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
