# Mistakes.party

A small Next.js index for projects, writing, games, and future shop work.

Public routes are prerendered from `content/site-content.json`. The Patreon
door and member room stay request-rendered because access is enforced with a
signed, HTTP-only cookie. The home-page atmosphere is a decorative SVG animated
entirely in CSS; it has no client state or network connection.

## Development

```sh
npm run dev
npm run lint
npm run build
npm test
```

Set `PATREON_ACCESS_PASSWORD` and `PATREON_SESSION_SECRET` to enable member
access. The password must be at least 12 characters and the session secret at
least 32 characters.
