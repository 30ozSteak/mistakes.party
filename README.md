# MXP / MISTAKES.PARTY

A loud, text-first portfolio for websites, apps, games, art, code, and useful
mistakes.

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

The project uses Next.js with vinext and produces a Cloudflare
Worker-compatible build in `dist/`. There is no database or authentication
service to operate. The canonical production address is configured as
`https://mistakes.party`, including its social-card metadata.

The portfolio fetches public repositories directly from GitHub in the browser
and falls back to a bundled project list when the API is unavailable.
