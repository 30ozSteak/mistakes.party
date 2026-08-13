# Party realtime service

The party backend is a Cloudflare Worker with one hibernating Durable Object
per public pathname. It provides route-local presence counts and four ephemeral
preset signals. It stores no artwork, messages, names, IP addresses, or signal
history.

The Worker keeps its existing deployed service name and hostname so replacing
the feature does not require a second infrastructure migration.

## Local development

```bash
npm run dev:realtime -- --port 8787
```

The health endpoint is `http://127.0.0.1:8787/health`. Point the website at the
local Worker when starting Next.js:

```bash
NEXT_PUBLIC_PARTY_REALTIME_URL=http://127.0.0.1:8787 npm run dev
```

`ALLOWED_ORIGINS` is a comma-separated list of exact browser origins allowed to
open WebSockets. The checked-in development value permits only the local app
and Playwright ports. Production permits only `https://www.mistakes.party`.
Origin is a browser cross-origin control, not authentication.

`PARTY_MODE=off|live` is the server-authoritative kill switch. In `off` mode a
valid WebSocket request still upgrades, receives a fatal `PARTY_DISABLED`
error, and closes with code 1008 so the browser can distinguish the kill switch
from a network failure.

`PARTY_GENERATION` partitions every route into fresh Durable Objects. Bump it
to abandon active route state. Presence and signals are already ephemeral, so
no application data needs to be migrated between generations.

Before deploying, run:

```bash
npm run check:realtime
```

Deploy with:

```bash
npm run deploy:realtime
```

Deployment replaces the prior drawing Worker. Migration history `v1` is
retained and `v2` creates `PartyRoute`. The retired `DrawingRoom` namespace is
deliberately preserved; it is no longer bound or reachable, but this deployment
does not delete its stored data. An inert `DrawingRoom` export remains solely
because Cloudflare requires historical Durable Object namespaces to retain a
matching class export.

## WebSocket contract

The shared strict protocol and browser URL helpers live in
`app/lib/partyProtocol.ts`.

Connect with `mistakes-party-presence-v1` as the sole WebSocket subprotocol:

```text
/v1/party?route=:canonicalPathname&sessionId=:optionalTabSessionId
```

The Worker rejects non-canonical paths, encoded traversal, and `/patreon` or
any nested Patreon route. Query strings and fragments never create separate
party routes. A server-issued, high-entropy session ID is returned in the
`welcome` message and kept in tab-scoped `sessionStorage`; it has no privileges
and is used only to avoid double-counting reconnect overlap.

Client messages are exactly one of:

```json
{"type":"signal:send","kind":"cheers"}
{"type":"signal:send","kind":"hi"}
{"type":"signal:send","kind":"bad_idea"}
{"type":"signal:send","kind":"i_was_here"}
{"type":"ping"}
```

Server messages are `welcome`, `presence`, `signal`, `error`, and `pong`.
Signals contain a server-generated UUIDv4 and timestamp, are broadcast to every
open socket on the route including the sender, and are never persisted or
replayed. Clients remove their visual treatment after a short timeout.

Each route is capped at 256 open sockets and each session at two sockets.
Presence counts unique session IDs, not connections. The Worker also enforces
an IP handshake limit, per-connection message and signal limits, a one-second
minimum signal interval, and a route-wide token bucket. Fixed ping/pong frames
use the Durable Object WebSocket auto-response API, so heartbeats do not wake a
hibernating object.
