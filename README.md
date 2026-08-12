# MXP / MISTAKES.PARTY

<<<<<<< HEAD
A loud, text-first portfolio for websites, apps, games, art, code, and occasional
mistakes
=======
A loud, text-first portfolio for websites, apps, games, art, code, and useful
mistakes.

## Local development

Requires Node.js 22.

```bash
npm install
npm run dev
```

## Production build

```bash
npm run lint
npm test
```

The persistent highlighter interaction suite uses Playwright:

```bash
npx playwright install chromium
npm run test:e2e
```

The project uses native Next.js and is configured for Vercel. Import the GitHub
repository as a Next.js project; Vercel will install dependencies and run
`npm run build` automatically. Pushes to `main` become production deployments,
while other branches receive preview deployments.

The homepage and blog index use Incremental Static Regeneration to refresh the
Medium feed every 15 minutes. There is no database, authentication service, or
required environment variable. The canonical production address is configured
as `https://mistakes.party`, including its social-card metadata.

The portfolio fetches public repositories directly from GitHub in the browser
and falls back to a bundled project list when the API is unavailable.
>>>>>>> cf1b7af (party mode)
