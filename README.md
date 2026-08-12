# STEAKS / MISTAKES.PARTY

A loud, text-first portfolio for websites, apps, games, art, code, and useful
mistakes by STEAKS.

## Local development

Requires Node.js 22.13 or newer.

```bash
npm install
npm run dev
```

## Production build

```bash
npm test
npm run lint
```

The project uses the standard Next.js toolchain and exports a self-contained
static site to `out/`. There is no application server, database, authentication
service, or platform-specific runtime to operate.

Publish the contents of `out/` with any static host. The canonical production
address is configured as `https://mistakes.party`, including its social-card
metadata.

The portfolio fetches public repositories directly from GitHub in the browser
and falls back to a bundled project list when the API is unavailable.
