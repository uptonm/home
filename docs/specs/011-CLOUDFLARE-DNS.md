---
plans: [009-CLOUDFLARE-DNS]
---

# Cloudflare DNS

> **PLANNED** — [`009-CLOUDFLARE-DNS`](../plans/009-CLOUDFLARE-DNS.md)
>
> **Every section of this document is unbuilt.** No `cloudflare` connection and
> no `cloudflare-dns` module exist. The spec landed ahead of the code so the
> shape could be settled before any of it was typed; the plan builds exactly
> what is described here, and drops this marker when it does.

Cloudflare is the second connection to back more than one module, and the first
one designed that way rather than discovered that way. One API token reaches
DNS, Workers, R2, Pages, and Zero Trust; `cloudflare-dns` is the only module
built against it, and it exists because the LAN already depends on Cloudflare
DNS in two places that are currently edited by hand.

The connection and module split, the shared config namespace, and the
`path`/`shortPath` mounting this module relies on are specified in
[005-MODULE-SYSTEM](005-MODULE-SYSTEM.md).

## Why this module exists

Host Caddy issues every `*.uptonm.io` certificate over DNS-01, which means
`caddy` holds a Cloudflare token and writes `_acme-challenge` TXT records into
the zone on every renewal. Nothing else in the homelab can see that zone, so
every question about it — what points where, whether a record survived a
renewal, why a name resolves to the wrong host — is answered today by opening
the Cloudflare dashboard.

The zone also carries a rule that is invisible in the dashboard and easy to
break: **`uptonm.io` is DNS-only and must never be proxied.** It resolves to a
private address, and orange-clouding any record in it would hand Caddy the
proxy's IP instead of the client's, silently breaking every `remote_ip` matcher
in the Caddyfile. That rule is the single most important thing this module
enforces.

## The connection

`cloudflare` owns one field: an API token, stored as a secret.

```
apiToken   secret, required   Zone:Read + DNS:Edit, scoped to the zones you want reachable
```

There is no account ID and no email. Cloudflare's legacy global key
authenticates as the whole account and cannot be scoped; a token can be limited
to two permissions on named zones, so the token is the only credential this
connection accepts. `home cloudflare-dns configure` prompts for it through the
connection chain.

Readiness is `GET /user/tokens/verify`, which returns the token's own status
without touching a zone. It answers exactly the question a connection probe
should — *is this credential live* — and distinguishes a revoked or expired
token from a zone that merely has no records.

Every request carries `Authorization: Bearer <apiToken>` against
`https://api.cloudflare.com/client/v4`. Responses share one envelope —
`{ success, errors, messages, result }`, with `result_info` on paginated reads —
so a single client helper unwraps `result` and turns a non-empty `errors` array
into a `SystemError` carrying Cloudflare's own numeric code, rather than letting
an HTTP 200 with `success: false` look like a success.

## The module

`cloudflare-dns` mounts at `['cloudflare','dns']` with no `shortPath`. Nobody
says "DNS" and means Cloudflare's, so the parent segment is load-bearing rather
than decoration, and a future `cloudflare-workers` mounts beside it.

Its generated skill is `home-cloudflare-dns`, named for the module rather than
its mount.

| Command | Effect | Purpose |
| --- | --- | --- |
| `home cloudflare dns zones list` | read | Every zone the token can see, with id, name, and status |
| `home cloudflare dns records list` | read | Records in a zone, filtered by `--type`, `--name`, `--content` |
| `home cloudflare dns records get <id>` | read | One record in full |
| `home cloudflare dns records create` | write | Add a record |
| `home cloudflare dns records update <id>` | write | Change a record's content, TTL, or comment |
| `home cloudflare dns records delete <id>` | destructive | Remove a record |

`delete` is `destructive` rather than `write` because it is outward-facing
without a containable target: removing an A record takes a name off the internet
until it is recreated, and the e2e harness refuses to execute it at all. `create`
and `update` are `write` — recoverable, and reachable by the harness only inside
a scenario that cleans up after itself.

Every mutating command is a dry run that prints what it would do and exits
without calling Cloudflare unless `--yes` is passed, following the same
convention as gmail's bulk triage and graphite's stack mutations.

## Zones are named, not numbered

Cloudflare identifies a zone by a 32-character hex id, and every DNS endpoint is
`/zones/:zone_id/dns_records`. Requiring an operator to paste that id would make
the module unusable from memory, so every command takes `--zone` as a **name**
(`uptonm.io`) and resolves it to an id through `GET /zones?name=`.

The resolution is cached for the process lifetime, not on disk. A zone id is
stable, but caching it in config would create a second thing to invalidate when
a zone is moved between accounts, and the lookup is one request.

Passing a value that is already a 32-character hex string skips the lookup, so
an id still works where someone has one.

## Proxying is opt-in and loud

`records create` and `records update` default `proxied` to `false`. Turning it
on requires an explicit `--proxied`, and against a zone whose records are all
currently unproxied the flag additionally requires `--yes` on its own terms —
the dry-run output states, in full, that the record will be served through
Cloudflare's edge and that origin IP visibility will be lost.

This is deliberately more friction than the API imposes. The Cloudflare API
defaults `proxied` to `false` for most record types already; the value here is
not the default but the refusal to let it be set silently, because the failure
it prevents is remote, delayed, and presents as a Caddy authorization bug rather
than a DNS change.

`records list` reports `proxied` as a column so the invariant can be checked at
a glance.

## ACME records are visible, never touched

`_acme-challenge` TXT records are written and deleted by Caddy's DNS-01 solver
on its own schedule. They appear in `records list` like anything else — seeing
one is often the answer to "why did renewal fail" — but the module offers no
command that targets them as a class, and deleting one is an ordinary
`records delete` with the same `--yes` and the same `destructive` effect.

Nothing here writes a TXT record on Caddy's behalf. Certificate issuance stays
Caddy's job; this module only lets a human see what Caddy is doing.

## Pagination is followed, not surfaced

`GET /zones/:id/dns_records` pages at 100 records and reports totals in
`result_info`. `records list` follows every page and returns the complete set,
because a homelab zone has tens of records and a partial answer to "what points
where" is worse than a slow one. There is no `--page` flag; if a zone ever grows
past the point where that is reasonable, `--name` and `--type` narrow the query
server-side first.
