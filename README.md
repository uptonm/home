# `home`

A monolith CLI that gives you (and your local LLMs) uniform access to your
homelab services. One binary, one config root, one Claude skill per module.

Modules:

- **`unifi`** — UniFi Network controller (devices, clients, site health, PoE cycle, client block/unblock)
- **`protect`** — UniFi Protect (cameras with PTZ/LED/talkback, lights, sensors, doorlocks, snapshots)
- **`assistant`** — Home Assistant (states, services, automations, scenes, scripts, calendars, templates, history, logbook)
- **`spotify`** — Spotify catalog (search, get by id, browse categories, new releases, children)
- **`sonos`** — Sonos players (playback, volume, groups, queue, favorites, playlists, library, EQ, alarms, notifications)
- **`tts`** — text-to-speech to an MP3 (macOS `say` / Linux `espeak-ng`), for hand-off to Sonos notify
- **`google`** — shared Google OAuth client for `gmail`/`gcal`/`gdrive` (configure once, authorize each; `logout` forgets all grants)
- **`gmail`** — Google Gmail (read-only: search messages/threads, list labels/drafts, mailbox profile)
- **`gcal`** — Google Calendar (read-only: calendars, events with recurring expansion, merged agenda, free/busy)
- **`gdrive`** — Google Drive (list/get/download/export files)
- **`discord`** — Discord (list channels, read messages, send a message via bot token)
- **`vercel`** — Vercel (read-only: projects, deployments, build events, domains) plus cross-machine sync of this CLI's own config
- **`github`** — GitHub remote state via the `gh` CLI (repos, PRs with reviews/checks/diffs, Actions runs, issues, notifications, releases, code search)
- **`graphite`** — local Graphite stacked branches via the `gt` CLI (stack layout, parent/children, restack-readiness; guarded mutations with `--yes`)
- **`linear`** — Linear (issues, projects with milestones, cycles, teams, your assigned work, planning summary; guarded writes with `--yes`)
- **`beszel`** — Beszel monitoring (host/container status, CPU/memory/disk pressure, metric history, SMART health, firing alerts)
- **`uptime-kuma`** — Uptime Kuma monitoring (endpoint up/down, latency, TLS cert expiry, incidents, maintenance windows)

`spotify`, `sonos`, and `tts` are designed to pair: search the catalog with
`spotify` and hand the URI to `sonos play-uri`, or synthesize an announcement
with `tts` and push it through `sonos notify`.

`gmail`, `gcal`, and `gdrive` share one Google OAuth client via the `google`
module: run `home google configure` once, then `home gmail configure` /
`home gcal configure` / `home gdrive configure` to authorize each (a browser
consent). `home google logout` forgets every grant. See `docs/google-setup.md`.

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/uptonm/home/main/scripts/install.sh | bash
```

The installer picks the right binary for your OS/arch and drops it in
`~/.local/bin/home` (or `/usr/local/bin/home` with sudo if `~/.local/bin`
isn't on `PATH`).

Supported targets:

- Linux x86_64 (`bun-linux-x64-baseline` — no AVX required)
- macOS arm64

The release repo is private, so the installer (and `home upgrade`) pull binaries
through the authenticated `gh` CLI — `gh auth login` first.

## Updating

Releases are automated: conventional-commit merges to `main` accumulate a
[release-please](https://github.com/googleapis/release-please) PR; merging it
tags `vX.Y.Z`, builds both binaries, and publishes the GitHub Release.

On a real (installed) binary, `home` checks for a newer release at most once a
day and prints a one-line banner when one exists. The check is cached and runs
in a detached background refresh — it never blocks or slows a command, is
silent under `--json`/pipes/CI, and can be turned off with `updateCheck: false`
in `~/.config/home/config.json`.

```bash
home upgrade            # show what it would do (requires --yes to install)
home upgrade --yes      # download the latest binary via gh and swap it in place
home upgrade --check    # report current vs latest; never installs
home upgrade --tag v0.2.0 --yes   # install a specific release
```

## Quick start

```bash
home init                       # create ~/.config/home/, pick a secrets backend
home configure                  # interactive configure for every module in turn
home skill install              # write ~/.claude/skills/home-<module>/SKILL.md (one per module)
home status                     # readiness + structured data across every module
home doctor                     # module status plus version/update diagnostics
home overview ops               # cross-module operational report (see below)
```

You can also configure modules one at a time — `home unifi configure`,
`home spotify configure`, etc. `sonos` needs **no** configuration to find
players over SSDP multicast; configure it only for cross-VLAN discovery
(set the speaker subnet, e.g. `10.0.10.0/24`).

Every command takes `--json` for clean machine-readable output:

```bash
home unifi devices list --json | jq '.[] | select(.type=="uap")'
home protect events recent --type motion --limit 5 --json
home assistant logbook list --since 24h --json
home spotify search "midnight city" --type track --json
home sonos players list --json
home gmail messages list --q "is:unread newer_than:2d" --hydrate --json
home gdrive files list --q "name contains 'report'" --json
```

Pair `spotify` with `sonos` to turn a search into playback:

```bash
# Find a track, copy its `uri` from the output, then play it on the patio:
home spotify search "alvvays archie" --type track --limit 1
home sonos play-uri "Patio" spotify:track:XXXXXXXXXXXXXXXXXXXXXX

# Speak an announcement on the kitchen speaker, restoring playback after:
file=$(home tts synth "Dinner is ready" --json | jq -r .path)
home sonos notify "Kitchen" --file "$file" --volume 40 --delete-after
```

Exit codes:

- `0` ok
- `1` user error (bad arg, unknown flag)
- `2` system error (network, controller unreachable)
- `3` not configured — run `home <module> configure`

## Config + secrets

- Config root: `~/.config/home/`
- Per-module config: `~/.config/home/modules/<name>.json` (URLs, site IDs, TLS toggle)
- Secrets: OS keyring (macOS Keychain / libsecret) by default; falls back to
  mode-0600 `~/.config/home/secrets.json` on headless Linux without libsecret
  (you'll be prompted during `home init`)

All secrets live in a **single** keyring entry (`home-cli` / `secrets`) holding
one JSON blob, rather than an entry per module. macOS attaches an ACL to each
keychain *item*, so an item-per-secret layout costs one "allow access?" prompt
per module — and every one of them repeats whenever the binary's identity
changes. One item means one grant.

Installs predating this migrate automatically: each secret folds into the shared
entry the first time it's read, and the old item is removed. Expect one last
prompt per secret while that happens, then no more.

### macOS keychain prompts

macOS pins a keychain grant to the **exact binary**, not to its signing
identity. A rebuild changes the bytes, so it re-asks — even when both builds
share a designated requirement (`identifier home and certificate leaf = …`).
Codesigning does not avoid this; it was verified not to.

What consolidation buys is that the dialog is now **one, not one per module**.
Click *Always Allow* (not *Allow*) so it sticks for that build.

For a tight edit/run loop, prefer `bun run src/index.ts …` over rebuilding: the
identity macOS sees is `bun`, which doesn't change as you edit, so the grant
holds. The compiled binary then costs one dialog per `bun run build:install`.

`scripts/setup-codesign.sh` is still worth running once — it gives builds a
stable identity and lets `codesign` use its key without a dialog per build — but
it will not stop the per-rebuild secrets prompt.

If prompts persist per *module* rather than once, some secrets are still in the
pre-consolidation layout: read them once (`home doctor`) to fold them in.

Rotate / migrate:

```bash
home unifi configure --rotate      # re-prompt secrets only
home unifi configure --force       # re-prompt everything

home secrets export --out ~/home-secrets.json   # move secrets between machines
home secrets import --in  ~/home-secrets.json
home config export --out ~/home-config.json     # module config only (no secrets)
home config import --in  ~/home-config.json
```

## Sharing a setup across machines

`home vercel` keeps the same config and secrets on more than one host (laptop +
server) using [Vercel shared environment variables][vercel-shared] as the store,
so there is no plaintext file to hand-carry between machines.

```bash
vercel login                    # the only auth step; or export VERCEL_TOKEN
home vercel configure           # pick the team that holds your variables

home vercel config diff         # compare this host against the store
home vercel config push         # upload this host's config + secrets
home vercel config pull         # apply the store to this host
```

Both directions take `--dry-run`.

Notes:

- **Additive both ways.** Neither `push` nor `pull` deletes anything: a value
  the other side lacks is left alone. Use the Vercel dashboard to remove one.
- **Last write wins.** `push` overwrites the store, `pull` overwrites this host.
  Run `config diff` first if both may have changed.
- **Host-specific settings never sync.** Fields marked `hostLocal` in a module's
  schema describe *this* machine's vantage point rather than the service, so
  they stay put — currently sonos `subnet`, which depends on the VLAN the host
  sits on.
- **Variables are stored `encrypted`, not `sensitive`.** Vercel cannot decrypt a
  `sensitive` value once written, so `pull` could never read it back. Anything
  holding a token for your team can read these — the store is as trusted as your
  Vercel account.
- **Sync is explicit.** Nothing calls Vercel unless you run `home vercel …`, so
  every other command keeps working from the local keyring when offline.

[vercel-shared]: https://vercel.com/docs/environment-variables/shared-environment-variables

## Shell completions

`home` generates completion scripts for bash, zsh, and fish straight from its
command tree, so they stay in sync as modules and commands are added.

```bash
# bash
home completions bash | sudo tee /usr/local/etc/bash_completion.d/home
#   or append to ~/.bashrc:  home completions bash >> ~/.bashrc

# zsh (place on your fpath, then restart the shell)
home completions zsh > "${fpath[1]}/_home"

# fish
home completions fish > ~/.config/fish/completions/home.fish
```

Completion covers every subcommand (including the synthetic
`configure`/`status`/`skill` per module) and each command's flags; zsh and fish
show inline descriptions.

## Telemetry

None. `home doctor` confirms this. The update check only asks `gh` for the
latest release tag (no metadata leaves your machine).

## Operational overview: `home overview ops`

Where `home status` answers "is each module reachable?", `home overview ops`
answers "how is the stack doing?" in one read-only report: the latest Vercel
**production** deployment (id, state, url, commit) per configured project,
Uptime Kuma monitor state with latency and cert expiry, and Beszel systems
with currently-triggered alerts — plus containers for the mapped systems.
Every item carries the ids you need for the next exact command
(`home vercel deployments get <id>`, `home uptime-kuma monitors get <id>`,
`home beszel containers list <system>`).

Correlation is **explicit, never name-matched**: create
`~/.config/home/overview.json` mapping each Vercel project to its Kuma monitor
ids and Beszel system ids/names:

```json
{
  "ops": {
    "projects": [
      { "vercelProject": "uptonm-dev", "kumaMonitors": [1, 2], "beszelSystems": ["boris"] }
    ]
  }
}
```

```bash
home overview ops --json                        # every mapping group
home overview ops --project uptonm-dev --json   # one group
```

Behavior:

- Modules are probed **concurrently**, and a module that is unconfigured or
  failing degrades gracefully: its data is omitted and a structured note
  (`{module, status, code?}`) lands in `notes`, with `status: "degraded"` on
  the report. Only an empty/missing mapping fails outright
  (`overview_failed`, exit 3).
- Monitors and systems that no group claims still appear, in the flat
  `unmapped` sections (bounded at 100 each).
- `--project` with an unknown name errors (`unknown_project`) listing the
  configured project names.
- Timestamps are ISO 8601; the command never mutates anything.

## Module commands

### `unifi`

| Command | Purpose |
| --- | --- |
| `home unifi devices list` | All adopted devices (APs, switches, gateway) |
| `home unifi devices get <mac>` | A single device by MAC address |
| `home unifi devices stats <mac>` | Latest device stats (CPU, memory, uptime, temps) |
| `home unifi devices restart <device> --yes` | Reboot a device by MAC or name |
| `home unifi devices poe-cycle <device> --port <n> --yes` | Power-cycle a switch PoE port — reboot an AP or camera |
| `home unifi clients list` | Currently-connected clients |
| `home unifi clients get <mac>` | Full stats for one client by MAC |
| `home unifi client <block\|unblock\|reconnect> <client>` | Block / unblock / reconnect a client by MAC, hostname, or IP |
| `home unifi clients authorize-guest <client> [--minutes <n>] --yes` | Authorize a guest client for hotspot access |
| `home unifi clients all` | All known clients, including offline |
| `home unifi vouchers list` | Hotspot guest vouchers |
| `home unifi vouchers get <id>` | One hotspot voucher by id |
| `home unifi vouchers create [--count <n>] [--minutes <n>] [--name <s>] [--quota <n>] --yes` | Create one or more hotspot guest vouchers |
| `home unifi vouchers delete <id> --yes` | Delete a hotspot voucher by id |
| `home unifi site info` | Site identity and raw stats |
| `home unifi site health` | Per-subsystem health (WAN, LAN, WLAN, WWW) |
| `home unifi networks list` | Networks/VLANs with subnet and DHCP range |
| `home unifi networks get <name>` | Full networkconf by name, VLAN id, or _id |
| `home unifi reservations list` | Fixed-IP reservations, labeled by VLAN |
| `home unifi reservations get <ref>` | Reservation by MAC, name, hostname, or IP |
| `home unifi wlans list` | SSIDs with security and mapped VLAN |
| `home unifi wlans get <ssid>` | Full raw wlanconf for one SSID |
| `home unifi port-forwards list` | WAN port-forward (NAT) rules |
| `home unifi port-forwards get <name>` | One portforward rule by name or _id |
| `home unifi firewall list` | Firewall rules |
| `home unifi firewall get <id>` | A single firewall rule by id |
| `home unifi firewall-groups list` | Firewall/IP groups |
| `home unifi firewall-groups get <name>` | One firewallgroup by name |
| `home unifi port-profiles list` | Switch port profiles (portconf) |
| `home unifi port-profiles get <name>` | One portconf profile by name |
| `home unifi wlan-groups list` | WLAN groups |
| `home unifi wlan-groups get <name>` | One wlangroup by name |
| `home unifi user-groups list` | User groups (bandwidth limits) |
| `home unifi user-groups get <name>` | One usergroup by name |
| `home unifi radius-profiles list` | RADIUS profiles |
| `home unifi radius-profiles get <name>` | One radiusprofile by name |
| `home unifi routes list` | Static routes |
| `home unifi routes get <name>` | One static route by name |
| `home unifi dpi-apps list` | DPI application signatures |
| `home unifi dpi-apps get <name>` | A single DPI app by name |
| `home unifi dpi-groups list` | DPI group configurations |
| `home unifi dpi-groups get <name>` | A single DPI group by name |
| `home unifi radius-accounts list` | RADIUS user accounts |
| `home unifi radius-accounts get <name>` | A single RADIUS account by name |
| `home unifi dynamic-dns list` | Dynamic DNS configurations |
| `home unifi tags list` | Device tags |
| `home unifi tags get <name>` | A single tag by name |
| `home unifi settings list` | Site settings (sections with keys) |
| `home unifi settings get <key>` | A single settings section by key |
| `home unifi events list [--limit <n>]` | Recent network events |
| `home unifi alarms list` | Active and archived alarms |
| `home unifi rogue-aps list` | Neighboring/rogue APs detected |
| `home unifi guests list` | Guest authorizations |
| `home unifi sessions list [--limit <n>]` | Historical connect/disconnect sessions |
| `home unifi dpi-stats site` | Per-application DPI traffic stats for the site |
| `home unifi dpi-stats client <mac>` | Per-application DPI traffic stats for one client |
| `home unifi controller info` | Controller version, build, update status, retention, timezone |
| `home unifi health` | Health rollup: wifi score, device up/down, utilization |

### `protect`

| Command | Purpose |
| --- | --- |
| `home protect cameras list` | All Protect cameras |
| `home protect cameras get <id>` | A single camera by id or name |
| `home protect cameras ptz <camera> <direction>` | Pan / tilt / zoom a PTZ-capable camera |
| `home protect cameras led <camera> <ir\|spotlight> <on\|off\|auto>` | Control a camera's IR LED or flood light |
| `home protect cameras talkback <camera>` | Print the talkback (two-way audio) WebSocket URL |
| `home protect events list [--since 1h] [--limit 50]` | Recent events |
| `home protect events get <id>` | A single event by id |
| `home protect events recent [--type motion\|smart] [--camera <id>] [--limit 10] [--since 24h]` | Pre-filtered, newest-first |
| `home protect lights list` | All Protect floodlights |
| `home protect lights get <id>` | A single floodlight by id or name |
| `home protect lights <on\|off\|toggle> <light> [--brightness 0-100]` | Control a Protect floodlight |
| `home protect sensors list` | All Protect sensors (door/window/motion/leak, temp/humidity/light) |
| `home protect sensors get <id>` | A single sensor by id or name |
| `home protect nvr info` | NVR info (model, firmware, storage, uptime) |
| `home protect doorlocks list` | All Protect smart locks (lock state, battery) |
| `home protect doorlocks get <id>` | A single smart lock by id or name |
| `home protect chimes list` | All Protect chimes |
| `home protect chimes get <id>` | A single chime by id or name |
| `home protect viewers list` | All Protect viewports |
| `home protect viewers get <id>` | A single viewport by id or name |
| `home protect bridges list` | All Protect bridges |
| `home protect bridges get <id>` | A single bridge by id or name |
| `home protect liveviews list` | All Protect live views |
| `home protect liveviews get <id>` | A single live view by id or name |
| `home protect ringtones list` | All Protect ringtones |
| `home protect users list` | All local Protect users |
| `home protect users get <id>` | A single user by id or name |
| `home protect groups list` | All Protect user groups |
| `home protect groups get <id>` | A single group by id or name |
| `home protect snapshot <camera> [--out path] [--stdout]` | JPEG snapshot (to file, or `--stdout` for raw bytes) |

### `assistant`

| Command | Purpose |
| --- | --- |
| `home assistant states list [--domain <d>]` | Entity states |
| `home assistant states search <query> [--domain <d>]` | Search entities by name / entity_id substring |
| `home assistant state get <entity_id> [--watch] [--interval <sec>]` | Single entity (optionally poll for changes) |
| `home assistant state set <entity_id> <state> [--attributes <json>] --confirm` | Override an entity state in the HA state machine (virtual write) |
| `home assistant light <on\|off\|toggle> <name\|id> [--brightness 0-100] [--color <c>]` | Control a light by name or id |
| `home assistant switch <on\|off\|toggle> <name\|id>` | Control a switch by name or id |
| `home assistant climate <name\|id> [--temperature <t>] [--mode <m>]` | Set thermostat temp / HVAC mode |
| `home assistant scene <name\|id>` | Activate a scene by name or id |
| `home assistant script <name\|id>` | Run a script by name or id |
| `home assistant automation trigger automation.<id>` | Fire an automation |
| `home assistant service call <domain>.<service> [--data <json>]` | Call any service |
| `home assistant services list [--domain <d>]` | List available services by domain |
| `home assistant events list` | List event types on the bus and their listener counts |
| `home assistant history get <entity_id> [--since 1h]` | State history |
| `home assistant logbook list [--since 1h] [--entity <id>]` | Human-readable events |
| `home assistant calendars list` | List calendar entities |
| `home assistant calendars get <entity_id> [--start <iso>] [--end <iso>]` | Calendar events in a window |
| `home assistant template <template>` | Render a Jinja2 template server-side |
| `home assistant camera snapshot <name\|entity_id> [--out path] [--stdout]` | JPEG snapshot from an HA camera |
| `home assistant error-log` | Tail the Home Assistant error log (plain text) |
| `home assistant config get` | Server config (version, components, unit system, location) |

### `spotify`

| Command | Purpose |
| --- | --- |
| `home spotify search <query> [--type <types>] [--limit N] [--market <code>]` | Search the catalog (`--type` = comma-separated subset of track,album,artist,playlist); returns Sonos-playable URIs |
| `home spotify track get <id\|uri\|url>` | Fetch one track — returns a `spotify:track:` URI |
| `home spotify album get <id\|uri\|url>` | Fetch one album — returns a `spotify:album:` URI |
| `home spotify album tracks <id\|uri>` | List an album's tracks (paged) |
| `home spotify artist get <id\|uri\|url>` | Fetch one artist |
| `home spotify artist albums <id\|uri> [--limit N] [--offset N] [--market <code>]` | List an artist's albums |
| `home spotify artist top-tracks <id\|uri> [--market <code>]` | An artist's top 10 tracks |
| `home spotify playlist get <id\|uri\|url>` | Fetch one playlist (metadata + track count) |
| `home spotify playlist tracks <id\|uri>` | List a playlist's tracks (paged) |
| `home spotify new-releases [--limit N]` | Newly released albums |
| `home spotify categories list [--limit N]` | Browse categories (Top Lists, Pop, Mood, etc.) |
| `home spotify categories get <id>` | A single browse category |

### `sonos`

| Command | Purpose |
| --- | --- |
| `home sonos players list` | All players discovered on the network |
| `home sonos players get <name>` | A single player by room name |
| `home sonos groups list` | Sonos groups (coordinator + members) |
| `home sonos groups get <room>` | One group: coordinator, transport state, every member with volume/mute |
| `home sonos groups join <room> <target>` | Add a room to another room's group |
| `home sonos groups leave <room>` | Split a room out of its group |
| `home sonos groups party` | Party mode: group every speaker under one coordinator |
| `home sonos groups ungroup` | Dissolve all groups — every room standalone |
| `home sonos now-playing [room]` | Current track for a room, or every group |
| `home sonos play [room]` | Resume playback (or the only group if room omitted) |
| `home sonos pause [room]` | Pause playback |
| `home sonos next [room]` | Skip to the next track |
| `home sonos prev [room]` | Skip to the previous track |
| `home sonos volume get <room>` | Read current volume (0-100) |
| `home sonos volume set <room> <level>` | Set volume (0-100) |
| `home sonos mute <room> [--state on\|off\|toggle]` | Mute / unmute (default toggle) |
| `home sonos queue list <room>` | Show the current queue |
| `home sonos queue clear <room>` | Clear the queue |
| `home sonos queue add <room> <uri> [--next] [--play] [--sn N]` | Add a URI to the queue |
| `home sonos queue remove <room> <position>` | Remove a track by 1-based position |
| `home sonos queue save <room> <title>` | Save the current queue as a Sonos playlist |
| `home sonos play-uri <room> <uri> [--sn N]` | Replace the transport with a URI and play |
| `home sonos favorites list` | Sonos favorites (My Sonos) |
| `home sonos favorites play <title>` | Play a Sonos favorite by title |
| `home sonos notify <room> [--file <path> \| --url <url>] [--volume <v>] [--timeout <s>] [--delete-after]` | One-shot clip/announcement, then restore what was playing |
| `home sonos spotify-accounts list` | Spotify accounts on the household (the `sn` for `--sn`) |
| `home sonos play-mode get <room>` | Read play mode (normal, shuffle, repeat, repeat-one, crossfade) |
| `home sonos play-mode set <room> [--repeat off\|all\|one] [--shuffle on\|off] [--crossfade on\|off]` | Set play mode (only the flags you pass change) |
| `home sonos sleep-timer get <room>` | Read sleep timer (remaining seconds or off) |
| `home sonos sleep-timer set <room> <duration>` | Start/cancel a sleep timer (`30m`, `1h`, `90`, `1:30:00`, or `off`/`cancel`) |
| `home sonos eq get <room>` | Read EQ (bass, treble, loudness) |
| `home sonos eq set <room> [--bass -10..10] [--treble -10..10] [--loudness on\|off] [--balance -100..100] [--night-mode on\|off] [--speech on\|off]` | Set EQ / audio settings (only the flags you pass change) |
| `home sonos group-volume get <room>` | Get per-member volumes in a group |
| `home sonos group-volume set <room> <level>` | Set volume on every group member |
| `home sonos group-mute <room> [--state on\|off\|toggle]` | Mute/unmute an entire group |
| `home sonos seek <room> <position>` | Seek to a position (seconds, "1:30", or "1:02:03") |
| `home sonos playlists list` | Sonos playlists (saved queues, SQ:) |
| `home sonos playlists get <title>` | Show tracks in a Sonos playlist |
| `home sonos playlists play <title> [room]` | Replace queue with a playlist and start playing |
| `home sonos library browse <category> [--id <objectID>] [--limit N]` | Browse local music library by category |
| `home sonos library search <category> <query> [--limit N]` | Search the local music library within a category |
| `home sonos music-services list` | Available music services (Spotify, Amazon, etc.) |
| `home sonos alarms list` | All Sonos alarms (household-wide) |
| `home sonos alarms get <id>` | One alarm by id |
| `home sonos alarms enable <id>` | Enable an alarm |
| `home sonos alarms disable <id>` | Disable an alarm |
| `home sonos line-in <room> [--tv]` | Play a speaker's line-in (or TV/HDMI input) |

### `tts`

| Command | Purpose |
| --- | --- |
| `home tts synth <text> [--voice <name>] [--rate <wpm>] [--out <path>]` | Synthesize text to an MP3 (macOS `say` / Linux `espeak-ng`, piped through `lame`) |

### `google`

Holds the one Google OAuth "Desktop app" client that `gmail`, `gcal`, and
`gdrive` share, so the same `clientId`/`clientSecret` isn't pasted per module.
No data commands.
Setup: `home google configure` once (see `docs/google-setup.md` for the Console
walkthrough — the app must be published to Production or its refresh tokens expire
in 7 days), then authorize each module with `home <module> configure`.

| Command | Purpose |
| --- | --- |
| `home google configure` | Store the shared OAuth client id/secret |
| `home google status` | Report whether the client is configured and which modules hold a grant |
| `home google logout` | Forget every Google module's refresh token (gmail, gdrive, gcal); the shared client stays configured |

### `gmail`

Read-only Gmail access using the Gmail API and Google OAuth.
Setup: `home google configure` (shared OAuth client — see `docs/google-setup.md`), then `home gmail configure` (opens a browser to authorize).

Works on consumer `@gmail.com` and Google Workspace accounts.

| Command | Purpose |
| --- | --- |
| `home gmail messages list --q <query> [--hydrate] [--max N]` | List message ids matching a Gmail search query. `--q` supports Gmail search syntax: `from:`, `subject:`, `is:unread`, `newer_than:`, `has:attachment`, etc. `--hydrate` fetches From/Subject/Date/snippet per message in one call. |
| `home gmail messages get <id>` | Get a single message by id (full headers, body, attachments metadata) |
| `home gmail threads list --q <query> [--max N]` | List thread ids matching a Gmail search query |
| `home gmail threads get <id>` | Get a thread and all of its messages by id |
| `home gmail labels list` | List all labels (system + user labels) |
| `home gmail labels get <id>` | Get a single label by id (includes message/thread counts) |
| `home gmail drafts list [--max N]` | List draft ids (each carries a message id and threadId) |
| `home gmail drafts get <id>` | Get a single draft and its message by id |
| `home gmail profile get` | Mailbox profile: email address, message/thread totals, historyId |

### `gcal`

Read-only Google Calendar access using the Calendar API and Google OAuth.
Setup: `home google configure` (shared OAuth client — see `docs/google-setup.md`,
with the Calendar API enabled), then `home gcal configure` (opens a browser to
authorize).

Owns Google Calendar schedule/agenda/availability. Home Assistant calendars are
a different surface — use `home assistant calendars` for those.

| Command | Purpose |
| --- | --- |
| `home gcal calendars list [--max N]` | List calendars on the account — owned, shared, and subscribed — with id, summary, primary flag, access role, and time zone |
| `home gcal events list [calendarId] [--from <t>] [--to <t>] [--q <text>] [--max N]` | List events ordered by start time, recurring events expanded to individual instances. Calendar defaults to `primary`; `--from`/`--to` take RFC 3339 or bare `YYYY-MM-DD` (local midnight). |
| `home gcal events get <calendarId> <eventId>` | Get a single event by id (full payload) |
| `home gcal agenda [--days N] [--calendars id,…] [--max N]` | Merged chronological briefing across calendars for the next N days (default 1, max 14). Defaults to every calendar on the account; all-day events sort ahead of timed ones on the same day. `truncated: true` when rows were cut at `--max`. |
| `home gcal freebusy --from <t> --to <t> [--calendars id,…]` | Busy intervals per calendar over a time range (max 90 days; calendars default `primary`). Per-calendar lookup failures (e.g. notFound) come back as data in `errors[]`, not as a command failure. |

### `gdrive`

Browse and fetch Google Drive files using the Drive API and Google OAuth.
Setup: `home google configure` (shared OAuth client — see `docs/google-setup.md`), then `home gdrive configure` (opens a browser to authorize).

| Command | Purpose |
| --- | --- |
| `home gdrive files list [--q <query>] [--limit N]` | List files. `--q` takes the Drive query language: `name contains 'report'`, `mimeType='application/pdf'`, `'<folderId>' in parents`, `modifiedTime > '2024-01-01'`. With no `--q`, lists all live (non-trashed) files. |
| `home gdrive files get <id\|name>` | Fetch full metadata for one file. Name resolves via a scoped search; ambiguous → lists candidates. |
| `home gdrive files download <id\|name> [--out <path>] [--stdout]` | Download a binary/uploaded file's bytes. Google-native docs (Docs/Sheets/Slides) cannot be downloaded — use `files export`. |
| `home gdrive files export <id\|name> --mime <type> [--out <path>] [--stdout]` | Export a Google-native doc to another format. `--mime` (required) accepts friendly aliases (`pdf`, `docx`, `xlsx`) or full MIME types. |

To sign out of Drive (and Gmail and Calendar), use `home google logout`.

### `discord`

Read and write Discord messages through a bot user — it lists the text channels
in a server, reads recent messages from a channel, and posts a message to one.
Everything runs against the Discord REST API with a bot token; the only writing
command is `send-message`.

Setup: `home discord configure` (a bot token created at discord.com/developers,
plus your server's Guild ID — right-click the server and Copy Server ID). The
bot must be a member of that guild and hold the permissions for the channels it
reads or posts to.

| Command | Purpose |
| --- | --- |
| `home discord list-channels [guildId]` | Text channels (type 0) in the guild — id, name, topic; the positional overrides the configured Guild ID |
| `home discord get-messages <channelId> [--limit N]` | Recent messages from a channel (id, author username, content, timestamp); `--limit` 1-100, default 25 |
| `home discord send-message <channelId> <text>` | Post a text message to a channel; returns the created message id, content, and timestamp |

### `vercel`

Read-only access to your Vercel team — projects, deployments, build events,
and domains — plus sharing this CLI's own config and secrets between machines
via the `config` commands (see
[Sharing a setup across machines](#sharing-a-setup-across-machines)). It never
deploys or mutates anything on Vercel.

Setup: `vercel login`, then `home vercel configure` (pick the team, and
optionally a default project whose newest production deployment
`home vercel status` reports).

| Command | Purpose |
| --- | --- |
| `home vercel projects list [--limit N]` | Projects with id, name, framework, linked repo, updatedAt |
| `home vercel projects get <id\|name>` | One project: framework, linked repo, production/preview targets, domains |
| `home vercel deployments list [--project <id\|name>] [--environment <target>] [--state <state>] [--limit N]` | Recent deployments, newest first; states normalized to `queued`/`building`/`ready`/`error`/`canceled` |
| `home vercel deployments get <id\|url>` | One deployment: state, commit, aliases, created/building/ready timing, creator |
| `home vercel deployments events <id\|url> [--limit N]` | Build/deployment events (mostly build log lines), bounded |
| `home vercel domains list [--project <id\|name>] [--limit N]` | Team-registered domains, or one project's domains, with verification state |
| `home vercel domains get <name>` | DNS configuration, owning project, and the project-level attachment |
| `home vercel config diff` | Compare this host against the store; reports only names, never values |
| `home vercel config push [--dry-run]` | Upload this host's config + secrets; creates and updates, never deletes |
| `home vercel config pull [--dry-run]` | Apply the store to this host; writes secrets to the keyring, config to `~/.config/home/modules/` |

### `github`

Read-only view of GitHub *remote* state through the official `gh` CLI — the
module never talks to the API itself and never writes. Local stacked-branch
topology is the graphite module's territory; this one owns what the remote
knows: PRs, reviews, checks, runs, issues.

Setup: install and authenticate `gh` (`gh auth login`), then
`home github configure`. Configuration is required so an absent `gh` binary
doesn't degrade `home status` on machines that don't use it. When `--repo` is
omitted, the configured `defaultRepo` applies, else the repo is inferred from
the current directory's git remotes.

| Command | Purpose |
| --- | --- |
| `home github repos get [owner/name]` | Repository identity: default branch, visibility, description, fork/archive flags |
| `home github prs list [--repo] [--state] [--author] [--limit N]` | List pull requests with author, head/base refs, and draft state |
| `home github prs get <number\|url> [--repo]` | One PR in detail: reviews, mergeability, refs, labels, stack links from the body |
| `home github prs checks <number\|url> [--repo]` | CI checks summarized: pass/fail/pending/skipped counts + failing check names |
| `home github prs diff <number\|url> [--repo] [--name-only]` | Size-capped patch (truncation flagged) or changed file names |
| `home github runs list [--repo] [--branch] [--status] [--limit N]` | List Actions workflow runs with status, conclusion, and branch |
| `home github runs get <id> [--repo]` | One run in detail: jobs, per-job conclusion and timing, URL |
| `home github issues list [--repo] [--state] [--label] [--limit N]` | List issues with author, labels, and assignees |
| `home github issues get <number\|url> [--repo]` | One issue in detail with its newest comments (bounded) |
| `home github summary [--repo]` | One briefing: my open PRs with check rollups, PRs awaiting my review, recent failed runs |
| `home github notifications list [--reason] [--limit N]` | Unread notifications: reason, repo, subject title/type, last update |
| `home github releases list [--repo] [--limit N]` | Recent releases: tag, name, publish date, prerelease/draft flags, URL |
| `home github search code <query> [--owner] [--repo] [--limit N]` | Code search: repo, path, URL, bounded matching fragments |

### `graphite`

View of *local* Graphite stacked-branch state through the `gt` CLI — which
branches are tracked, how they stack, whether a branch is safe to restack —
plus guarded stack actions. Every write requires `--yes` (refusing with
`confirmation_required` otherwise), always runs gt with `--no-interactive`,
and never passes a force flag — submit pushes stay `--force-with-lease`. A
merge/rebase conflict comes back as `graphite_conflict` with gt's text
verbatim; the module never auto-resolves. Remote PR state — reviews, checks,
mergeability — is the github module's territory.

Setup: install and authenticate `gt` (`gt auth`), then
`home graphite configure`. `gt` promises no machine-readable output, so every
result preserves gt's complete raw text in a `raw` field next to the
best-effort parsed fields; parsers are written against gt 1.8.6 and `home
graphite status` flags an untested major version (`compatible: false`) without
blocking commands. All commands except `status` need the cwd inside a git
working tree.

| Command | Purpose |
| --- | --- |
| `home graphite stack list [--all]` | Tracked branches from `gt log short` (raw preserved) with per-branch parents from bounded gt lookups |
| `home graphite stack get [branch]` | One branch via `gt info`: parent, PR number/state/title, Graphite URL, tip commit |
| `home graphite stack validate [branch]` | Non-mutating restack readiness: tracked, parent known, restack marker, clean working tree |
| `home graphite stack restack [--branch b] --yes` | Rebase the stack onto up-to-date parents; conflicts halt as `graphite_conflict` |
| `home graphite stack sync --yes` | Pull trunk and restack open stacks; never deletes branches itself (gt 1.8.6 has no `--no-delete` — any deletion gt performs is surfaced verbatim in `deletedBranches`) |
| `home graphite stack submit [--draft] [--dry-run] --yes` | Push the stack and create/update PRs (`--no-edit`); `--dry-run` only reports and needs no `--yes` |
| `home graphite stack merge --yes` | Merge every PR from trunk to the current branch via Graphite (gt 1.8.6 has no partial-merge flag) |
| `home graphite branch parent [branch]` | Parent of the current or named branch; trunk reports `parent: null`, `isTrunk: true` |
| `home graphite branch children [branch]` | Children of the current branch (`gt children`), or derived for a named branch |
| `home graphite branch create <name> --message <msg> --yes` | Stack a new branch committing only already-staged changes — never stages anything |
| `home graphite branch track <branch> --parent <p> --yes` | Start tracking an existing branch under an already-tracked parent |
| `home graphite repo trunk` | The repository's trunk branch as gt reports it |
### `linear`

Linear over its GraphQL API — the module owns work planning and issue state.
Team/state/assignee/project arguments accept an exact key/id first, then an
exact case-insensitive name; an ambiguous name is refused with the candidates
listed — on reads and writes alike.

Writes are guarded: every mutation requires `--yes` and refuses with the stable
`confirmation_required` code otherwise (never an interactive prompt). Body and
description text arrives via stdin (`--body-stdin` / `--description-stdin`),
never argv. Priority takes names (`urgent`, `high`, `medium`, `low`, `none`);
unknown names are rejected. Every mutation result names its exact target and
echoes what changed. There are no delete or archive commands.

Setup: `home linear configure` (personal API key from linear.app → Settings →
Security & access; optional default team).

| Command | Purpose |
| --- | --- |
| `home linear issues list [--team] [--state] [--assignee] [--project] [--limit N]` | List issues by last update: identifier, title, state (name + type), assignee, priority, project. `--assignee me` targets the viewer. |
| `home linear issues get <identifier\|id>` | One issue in full — description, relations, labels, project, cycle, comment count. Accepts `UPT-123` or a UUID. |
| `home linear issues search <query> [--team] [--limit N]` | Full-text search over issues |
| `home linear issues create --title <t> --team <team> [--description-stdin] [--project] [--assignee] [--priority] [--state] --yes` | Create an issue in an exactly-resolved team (no defaultTeam fallback); returns the created identifier and URL |
| `home linear issues update <identifier\|id> [--title] [--description-stdin] [--assignee] [--priority] [--state] --yes` | Update an issue — only the fields passed are sent; returns the issue identifier and the changed fields |
| `home linear issues comment <identifier\|id> --body-stdin --yes` | Comment on an issue, body piped via stdin; returns the comment id and issue identifier |
| `home linear projects list [--state]` | Projects with state, health, progress, target date, lead |
| `home linear projects get <id\|name>` | One project in full, including milestones |
| `home linear projects update <id\|name> [--name] [--description-stdin] [--state] [--target-date] --yes` | Update a project resolved exactly by id or name; returns the project id and the changed fields |
| `home linear cycles list [--team] [--active] [--limit N]` | Cycles with number, start/end, progress |
| `home linear teams list` | Teams — id, key, name |
| `home linear my-work list [--state] [--limit N]` | Your assigned issues in actionable order (in-progress first, then triage/todo/backlog; higher priority first) |
| `home linear summary [--team]` | One planning snapshot: your active issues, blocked issues, active cycle with progress, projects at risk |
### `beszel`

Read-only view of the [Beszel](https://beszel.dev) monitoring hub — it answers
"what is wrong with the machine or container?": host up/down, CPU/memory/disk
pressure, per-container resource usage and docker health, bounded metric
history, disk SMART health, and which alerts are firing. Synthetic service
availability checks belong to uptime-kuma, not here.

Setup: `home beszel configure` (hub URL, a regular hub user's email + password;
OIDC-only accounts can't authenticate — the module reports
`beszel_auth_unavailable` if the hub has password login disabled).

The hub is PocketBase-based and its API may shift between minor releases; the
adapter targets the 0.18.x schema and fails with a stable
`beszel_incompatible_version` code rather than guessing when a required field
is missing. Raw PocketBase records never leak — every command returns
normalized shapes (ISO 8601 timestamps, explicit units: `cpuPct`, `memoryGb`,
`memoryMb`, `netBytesPerSec`, …). `<system>` accepts an exact id or exact
case-insensitive name; ambiguous names list the candidates instead of picking.
History is never unbounded: when `--interval` is omitted it is auto-selected
from the window (≤2h→1m, ≤8h→10m, ≤24h→20m, ≤5d→120m, else 480m), and when a
window holds more than `--max` points the most recent ones win with
`truncated: true`.

| Command | Purpose |
| --- | --- |
| `home beszel systems list [--status up\|down\|paused\|pending]` | Monitored systems with status and headline cpu/mem/disk % |
| `home beszel systems get <id\|name>` | One system plus its latest 1-minute stats sample (memory, swap, disk, network, temps, load) |
| `home beszel containers list <system> [--limit N]` | A system's containers: status, health, cpu %, memory MB, network bytes/s |
| `home beszel containers get <system> <id\|name>` | One container on a system |
| `home beszel metrics get <system> [--since <30m\|6h\|2d\|ISO>] [--interval 1m\|10m\|20m\|120m\|480m] [--max N]` | Bounded system metric history; default last 60m, max 120 points (cap 500), `truncated: true` when the window held more |
| `home beszel container-metrics get <system> <container> [--since …] [--max N]` | Bounded per-container history (cpu %, memory MB, net bytes/s) from `container_stats` |
| `home beszel smart get <system>` | SMART/eMMC disk health: state, temperature, power-on hours, cycles, bounded raw attributes; empty is ok-with-note, not an error |
| `home beszel alerts list [--system <id\|name>] [--active] [--limit N]` | Configured alerts (type, threshold, triggered), newest change first |
| `home beszel overview` | Compact all-system summary: up/down counts, active alerts, per-host cpu/mem/disk % |

### `uptime-kuma`

Read-only view of an [Uptime Kuma](https://github.com/louislam/uptime-kuma)
instance — it answers "can a user or dependent system reach the service?":
endpoint up/down, response latency, TLS certificate expiry, published
incidents, and maintenance windows. When a service is down, the host or
container *cause* (CPU, memory, disk, docker health) is beszel's job, and
network gear belongs to `unifi`.

Setup: `home uptime-kuma configure` (instance URL, access mode, and the mode's
inputs). Two modes, both targeting Kuma 1.23.x:

- **`public-status`** reads the instance's public status-page API without
  credentials — needs `statusPageSlug`, sees only monitors published on that
  page. **Public data is cached:** the routes are served from Kuma's
  server-side cache (heartbeat ~1 min, page config ~5 min) on top of each
  monitor's poll interval, so results can trail reality by ~5 minutes.
- **`authenticated-socket`** logs in over Socket.IO with `username` +
  `password` (stored as a secret) and reads *every* monitor, live. Each CLI
  invocation is one-shot: connect, log in, collect the server's initial state
  burst (bounded settle window), disconnect — no daemon, no persistent
  connection. **2FA accounts are not supported** (the login is refused with
  `kuma_2fa_unsupported`; use a non-2FA account) — an explicit later spike.
  Servers outside the tested 1.23.x series are refused with
  `kuma_untested_version` unless `allowUnsupported` is set. One asymmetry:
  Kuma pushes no incidents over the authenticated socket, so `incidents list`
  is only meaningful in public mode.

Every command carries a `freshness` object — `cachedTransport` (`true` on the
cached public transport, `false` on the live socket) plus `newestBeatAt`, the
newest heartbeat timestamp that command saw (null when it read no heartbeats).

Timestamps are normalized to ISO 8601, heartbeat status ints to
`up`/`down`/`pending`/`maintenance`. `<monitor>` accepts an exact id or exact
case-insensitive name; ambiguous names list the candidates instead of picking.
Stable codes: `kuma_page_not_found` (instance reachable, slug missing —
distinct from `kuma_unreachable`), `kuma_api_failed`, `kuma_auth_failed`,
`kuma_2fa_unsupported`, `kuma_untested_version`, `kuma_socket_failed`, and
`kuma_auth_mode_required` (an auth-only command ran in public mode).

| Command | Purpose |
| --- | --- |
| `home uptime-kuma pages get [slug]` | Status-page metadata: title, groups with monitors, published incident, maintenance windows (auth mode: the full private inventory as one page) |
| `home uptime-kuma monitors list [--status up\|down\|pending\|maintenance]` | Monitors with latest heartbeat state, latency, 24h uptime |
| `home uptime-kuma monitors get <id\|name>` | One monitor: state, avg/min/max latency over the recent beats, cert expiry when known |
| `home uptime-kuma heartbeats list <id\|name> [--since ISO] [--limit N]` | Recent checks for one monitor with latency and failure messages (auth mode only, ≤100 beats) |
| `home uptime-kuma certificates list [--days N]` | Stored TLS certs — validity, days remaining, expiry; `--days` keeps soon-to-expire, invalid always kept (auth mode only) |
| `home uptime-kuma incidents list` | Currently published (pinned) incidents (public mode; empty with a note in auth mode) |
| `home uptime-kuma maintenances list` | Maintenance windows — active ones in public mode, all windows with status in auth mode |
| `home uptime-kuma summary` | Counts by state, worst state, avg latency, freshness timestamp |

## Development

Requires Bun ≥ 1.3.

```bash
bun install
bun run typecheck
bun run test                # NOT `bun test` — see below
bun run dev -- unifi --help
bun run build:linux         # bun-linux-x64-baseline → dist/home-linux-x64
bun run build:mac           # bun-darwin-arm64       → dist/home-darwin-arm64
```

### Running tests

Use `bun run test` (which runs `scripts/test-isolated.sh`), not `bun test`.

Bun's `mock.module()` is process-global with no teardown, and bun evaluates
every test file's module scope before running any test. So a command test that
mocks a client module — say `gmail-messages.test.ts` mocking
`../modules/gmail/client` — replaces that module for *every* file in the run,
including `gmail-client.test.ts`, which exists to exercise the real one. Those
tests then fail based on nothing but who else is in the run.

`bun test --isolate` / `--parallel` don't fix it; they break top-level-await
imports in the sonos suites instead. So each file gets its own process. Every
file passes alone, and the whole suite costs about a second more.

`bun run test <file>` delegates straight to `bun test <file>` for a single file.

Adding a module: create `src/modules/<name>/index.ts` exporting a
`ModuleManifest`, add it to `src/registry.ts`, and `home skill install`
will write its SKILL.md alongside the others.

### E2E harness

`bun run e2e` runs the dev CLI against the real homelab — the pre-release
gate before `build:install`. It is not part of `bun test`, which stays
fully offline.

```bash
bun run e2e                     # everything: preflight, auto-reads, scenarios
bun run e2e -- --module sonos   # one module
bun run e2e -- --reads-only     # skip write scenarios
bun run e2e -- --dry-run        # print the plan, spawn nothing
```

Every command declares `effect: 'read' | 'write' | 'destructive'` (the
smoke test rejects unclassified commands). The harness auto-runs all
`read` commands — args come from `e2e/args.ts` providers, usually chained
off a sibling `list` — and covers `write` commands via snapshot → mutate →
assert → restore scenarios in `e2e/scenarios/`. `destructive` commands are
refused by `e2e/cli.ts`, the single spawn choke point, so a scenario
physically cannot run one. Real-world test targets (which speaker may make
noise) live in `e2e/fixtures.ts`.

Unconfigured or unreachable modules are skipped and reported, not failed.
The closing report lists coverage plus anything runnable that was never
exercised, so new commands can't silently dodge the suite.

## License

MIT
