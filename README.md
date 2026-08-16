# MXP / MISTAKES.PARTY

A quiet, mobile-first external index for public GitHub work, recent Medium
writing, itch.io games, support, and useful mistakes.

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

### Cost safeguards

The checked-in application bounds server work in several layers:

- request-rendered Next.js routes declare a ten-second maximum duration;
- Server Action bodies are capped at 32KB;
- repository detail requests must first match the bounded GitHub owner index,
  so arbitrary slugs cannot create arbitrary outbound fetch keys;
- realtime admission uses fast per-IP/per-location edge limits plus a durable,
  globally coordinated house budget of 60 admissions per minute;
- all active house sockets share a 60-event/second application budget, so
  per-socket allowances cannot multiply into unbounded Durable Object work;
- Worker invocations have a 100ms CPU ceiling, and the rolling afterglow stores
  at most 2,048 anonymous sessions.

Account-level controls are still required. On Vercel Pro, configure
[Spend Management](https://vercel.com/docs/spend-management) with **Pause
production deployments** enabled; a notification-only budget is not a hard
stop. Keep the Server Action Firewall rule above in place. On Cloudflare Paid,
configure a low usage budget alert and monitor Worker and Durable Object usage;
Cloudflare budget alerts notify but do not automatically stop usage.

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
authorization boundary. Anonymous party presence is disabled throughout the
`/patreon/*` subtree so member pages never expose who is in the member area.

The public portfolio is one anonymous shared house. Each active tab appears as
an abstract light, `KNOCK` sends a short shared refraction, and arrivals plus a
visitor's first knock contribute to a rolling 24-hour color afterglow. The
homepage renders the full field; inner pages use a restrained header pulse.
There are no names, exact cursors, routes, chat, artwork, or permanent history.
Coarse 3×3 movement unlocks after the first knock, defaults on only for a fine
pointer, and can be switched off for the rest of the tab session. To run the realtime service locally, start both
processes with a matching public URL:

```bash
npm run dev:realtime -- --port 8787
NEXT_PUBLIC_PARTY_REALTIME_URL=http://127.0.0.1:8787 npm run dev -- --port 3000
```

## Production build

```bash
npm run lint
npm test
```

`npm test` includes the Cloudflare Workers-runtime suite, the production Next.js
build, and the server-rendered protocol/content tests.

The browser interaction suite uses Playwright:

```bash
npx playwright install chromium
npm run test:e2e
npm run test:party:off
```

The Next.js site deploys to Vercel from `main`. Realtime party presence is a
separate Cloudflare Worker backed by Durable Objects and deploys with:

```bash
npm run check:realtime
npm run deploy:realtime
```

Production defaults to:

```text
https://mistakes-party-drawing-realtime.mistakes.workers.dev
```

The hostname is retained from the earlier relay to avoid an unnecessary DNS
cutover. `NEXT_PUBLIC_PARTY_REALTIME_URL` is the build-time override for local
development or another relay. The Worker production origin allowlist must
contain the exact website origin (`https://www.mistakes.party`).

Living Glass has two v2 production controls in `worker/wrangler.jsonc`:

- `PARTY_HOUSE_MODE=off|presence|live` is the server-authoritative rollout
  switch. `presence` keeps the light field read-only; `live` enables `KNOCK`
  and consented coarse motion; `off` removes the experience. The checked-in
  production environment starts in `presence` for the Worker-first smoke test;
  promote it to `live` only after that validation passes and before deploying
  the site client.
- `PARTY_GENERATION` partitions the shared house and its 24-hour afterglow.
  Increment it only when an emergency reset is intended.

The legacy `PARTY_MODE=off|live` control and `/v1/party` protocol remain intact
as a rollback path while v2 settles.

Deploy Worker changes before the site client that depends on them, then verify
`/health`, cross-route house counts, a shared knock, rolling afterglow, and all
three house modes. The retired drawing room and v1 party namespaces remain
preserved. See [worker/README.md](worker/README.md) for the protocol, limits,
privacy boundary, and deployment details.

The homepage is a server-rendered external index with native expandable
sections. Its guarded GitHub and Medium requests refresh their cached source
data every 15 minutes; the deeper blog and code routes remain available.
