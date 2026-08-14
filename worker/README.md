# Party realtime service

The Cloudflare Worker coordinates one anonymous, sitewide Living Glass house.
Its SQLite-backed `PartyHouse` Durable Object uses hibernating WebSockets for
live lights, knocks, and coarse opt-in movement, while retaining only a rolling
24-hour aggregate color afterglow. It stores no names, exact cursor positions,
page routes, raw session IDs, IP addresses, messages, or permanent history.

The existing `/v1/party` route and `PartyRoute` namespace remain intact as a
rollback path. The retired `DrawingRoom` namespace is still unbound and
unreachable, but its inert export and migration history remain so its stored
data is never deleted as a side effect of this release.

## Local development

```bash
npm run dev:realtime -- --port 8787
NEXT_PUBLIC_PARTY_REALTIME_URL=http://127.0.0.1:8787 npm run dev
```

The health endpoint is `http://127.0.0.1:8787/health`.
`ALLOWED_ORIGINS` is a comma-separated exact browser-origin allowlist. Origin
checking limits browser callers; it is not authentication.

The v2 rollout switch is `PARTY_HOUSE_MODE=off|presence|live`:

- `off` rejects the house connection with a fatal `PARTY_DISABLED` error.
- `presence` exposes the roster and afterglow but rejects knocks and movement.
- `live` enables the complete interaction.

`PARTY_GENERATION` names a fresh shared house. Changing it intentionally resets
live membership and separates the afterglow. The v1-only `PARTY_MODE` remains
available during rollback.

Before deployment, run:

```bash
npm run check:realtime
npm run test:worker
```

Migration `v3` creates the SQLite-backed `PartyHouse`; earlier migrations and
namespaces must not be removed. The checked-in production configuration starts
v2 in read-only `presence` mode. Use this sequence:

1. Deploy with `npm run deploy:realtime`.
2. Run `PARTY_HOUSE_EXPECTED_MODE=presence npm run smoke:party:production`.
3. Change the production `PARTY_HOUSE_MODE` value to `live`, deploy again,
   and run `npm run smoke:party:production`.
4. Deploy the site client only after both v2 probes and the included v1
   compatibility probe pass.

## Living Glass v2 contract

Connect to `/v2/house` with `mistakes-party-house-v2` as the sole WebSocket
subprotocol. The URL accepts no query parameters. The first message supplies a
tab-scoped reconnect ID inside the socket rather than leaking it into platform
URL logs:

```json
{"type":"house:hello","generation":null,"sessionId":null}
```

The other client messages are:

```json
{"type":"ping"}
{"type":"knock:send","requestId":"<uuid>","zone":4}
{"type":"light:move","zone":4,"energy":1,"sharing":true}
```

The Worker sends `house:welcome`, `house:snapshot`, `light:move`, `knock`,
`error`, and `pong`. All message objects use exact keys and stay below 2KB.
Zones are the integers 0–8 in a 3×3 viewport grid; energy is 0–2. Exact cursor
coordinates never cross the network. Exact `ping` frames use the Durable Object
hibernation auto-response path, so routine heartbeats do not wake the object or
consume its application-message budget.

The house counts distinct reconnect IDs, permits two sockets per session, and
caps the house at 512 sockets. Clients render at most 12 server-selected lights;
everyone else still contributes to the exact count and aggregate intensity.
Public light IDs, palette indices, and animation seeds are deterministic hashes
distinct from reconnect IDs.

Knocks have a four-second per-session minimum, a twelve-per-minute session
limit, and a house token bucket. Movement is bounded to two changed, quantized
updates per second. The browser does not begin sending movement until the
visitor has knocked and opted in; the server still treats the session ID as an
untrusted decorative identifier, never authorization.

## Afterglow

`afterglow_sessions` stores only a one-way session hash, palette index, and
nullable arrival/knock timestamps. A first arrival contributes weight 1 and a
first accepted knock contributes weight 3. Each contribution decays linearly
to zero over 24 hours. Alarms refresh the aggregate while sockets are active
and remove expired timestamps; rows disappear when both timestamps expire.

No roster, movement, route, or knock history is persisted. Any operational logs
are limited to aggregate throttling and error events; identifiers and raw IPs
are never logged.

## Legacy v1 contract

`/v1/party?route=:canonicalPathname&sessionId=:optionalTabSessionId` still uses
the sole `mistakes-party-presence-v1` subprotocol and the strict protocol in
`app/lib/partyProtocol.ts`. It retains its route-local counts and four ephemeral
signals unchanged. New site clients use v2 only.
