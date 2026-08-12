# Drawing realtime service

The drawing party backend is a Cloudflare Worker with one SQLite-backed
Durable Object per invite-only room. The Worker is intentionally separate from
the Next.js deployment; no Cloudflare credentials are required for local use.

## Local development

```bash
npm run dev:realtime -- --port 8787
```

The health endpoint is `http://127.0.0.1:8787/health`. Point the website at the
local Worker when starting Next.js:

```bash
NEXT_PUBLIC_DRAWING_REALTIME_URL=http://127.0.0.1:8787 npm run dev
```

`ALLOWED_ORIGINS` is a comma-separated Worker environment variable. Set it to
the exact production and preview origins allowed to open browser WebSockets.
`ROOM_TTL_SECONDS` controls how long stored room artwork survives after its last
participant disconnects and defaults to 1,800 seconds.

The top-level `ALLOWED_ORIGINS` value is development-only so local Next.js and
Playwright servers work without extra flags. `npm run deploy:realtime` selects
the checked-in Wrangler `production` environment, whose allowlist contains only
`https://www.mistakes.party`. Only add another exact HTTPS origin when it
actually serves the application; a redirect-only apex origin does not need
WebSocket access.

Before deploying, run `npm run check:realtime`. Deploy the room service with
`npm run deploy:realtime`, then set the resulting HTTPS origin as
`NEXT_PUBLIC_DRAWING_REALTIME_URL` in the website deployment and rebuild it.

## WebSocket contract

The shared TypeScript contract and defensive JSON parsers live in
`app/lib/drawingRealtimeProtocol.ts`.

Connect to:

```text
/v1/rooms/:roomId?participantId=:publicId&name=:name&route=:pathname
```

Browser clients authenticate with these two WebSocket subprotocol offers:

```text
mistakes-party-drawing-v1, mistakes-party-auth.PARTICIPANT_TOKEN
```

The Worker validates the credential from `Sec-WebSocket-Protocol`, but selects
and returns only the non-secret `mistakes-party-drawing-v1` protocol. This keeps
the credential out of URLs and ordinary request/access logs. Infrastructure
must also avoid logging the offered `Sec-WebSocket-Protocol` header because it
contains the credential.

Room IDs, participant IDs, and participant tokens are high-entropy URL-safe
values. Each token is scoped by its room Durable Object, stored against the
public participant ID on first join, and never included in an invite or
presence event. The browser keeps each room identity in tab-scoped
`sessionStorage`, never `localStorage`; a newly opened tab gets an independent
room identity. A room has an additional hard limit of two sockets per
participant and eight sockets overall. The room rejects connections without an
allowed `Origin` as a browser cross-origin control; `Origin` is not client
authentication because a non-browser client can supply it.
The room remembers at most 32 participant ID/token pairs across its lifetime.
Known identities can still reconnect at that limit, while new identities must
wait for the room to expire and be recreated.

Participant names are normalized on the Worker and validated by the shared
protocol. They are limited to 40 ASCII letters, numbers, spaces, apostrophes,
and hyphens, with `Guest` used when normalization produces no valid name.

The server sends a `welcome` event containing the active-route snapshot, then
uses `presence`, `stroke:start`, `stroke:append`, `stroke:end`,
`route:snapshot`, `cursor:move`, `strokes:cleared`, and `room:reset` events.
Browser clients send the corresponding stroke/cursor events plus `route:set`,
`clear:mine`, `room:reset`, and `ping`.

Append batches must be sent exactly once and in order. Protocol v1 does not add a
sequence number or deduplicate retried `stroke:append` messages. An identical
`stroke:start` retry and a repeated `stroke:end` are safe; after `stroke:end` is
processed, the server rejects any further appends to that stroke.

Capacity and identity rejections are WebSocket-visible: the Worker accepts the
upgrade, sends a fatal typed `error`, and closes with code 1008. `clear:mine`
uses the identity bound to the socket and can only remove that participant's
strokes on the active route. `room:reset` is restricted to the current host.

Room storage is bounded to 2,000 strokes, 20,000 points per stroke, and 200,000
points total. Incoming messages are schema-validated, limited in size, and
rate-limited before storage or broadcast.
