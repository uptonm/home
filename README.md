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
- **`gmail`** — Google Gmail (read-only: search messages/threads, list labels/drafts, mailbox profile)
- **`gdrive`** — Google Drive (list/get/download/export files)
- **`gchat`** — Google Chat (read-only: spaces, members, messages)

`spotify`, `sonos`, and `tts` are designed to pair: search the catalog with
`spotify` and hand the URI to `sonos play-uri`, or synthesize an announcement
with `tts` and push it through `sonos notify`.

`gmail`, `gdrive`, and `gchat` share a Google OAuth flow via `home <module> auth login`.

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

## Quick start

```bash
home init                       # create ~/.config/home/, pick a secrets backend
home configure                  # interactive configure for every module in turn
home skill install              # write ~/.claude/skills/home-<module>/SKILL.md (one per module)
home doctor                     # status across every configured module
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
home gchat spaces list --json
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

Rotate / migrate:

```bash
home unifi configure --rotate      # re-prompt secrets only
home unifi configure --force       # re-prompt everything

home secrets export --out ~/home-secrets.json   # move secrets between machines
home secrets import --in  ~/home-secrets.json
home config export --out ~/home-config.json     # module config only (no secrets)
home config import --in  ~/home-config.json
```

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

None. `home doctor` confirms this. Update checks query the GitHub Releases API
only (no metadata leaves your machine).

## Module commands

### `unifi`

| Command | Purpose |
| --- | --- |
| `home unifi devices list` | All adopted devices (APs, switches, gateway) |
| `home unifi devices get <mac>` | A single device by MAC address |
| `home unifi devices poe-cycle <switch> <port>` | Power-cycle a switch port (PoE) — reboot an AP or camera |
| `home unifi clients list` | Currently-connected clients |
| `home unifi client <block\|unblock\|reconnect> <client>` | Block / unblock / reconnect a client by MAC, hostname, or IP |
| `home unifi site info` | Site identity and raw stats |
| `home unifi site health` | Per-subsystem health (WAN, LAN, WLAN, WWW) |

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
| `home assistant state get <entity_id> [--watch]` | Single entity (optionally poll for changes) |
| `home assistant state set <entity_id> <state> [--attributes <json>]` | Set entity state |
| `home assistant light <on\|off\|toggle> <name\|id> [--brightness 0-100] [--color <c>]` | Control a light by name or id |
| `home assistant switch <on\|off\|toggle> <name\|id>` | Control a switch by name or id |
| `home assistant climate <name\|id> [--temperature <t>] [--mode <m>]` | Set thermostat temp / HVAC mode |
| `home assistant scene <name\|id>` | Activate a scene by name or id |
| `home assistant script <name\|id>` | Run a script by name or id |
| `home assistant automation trigger automation.<id>` | Fire an automation |
| `home assistant service call <domain>.<service> [--data <json>]` | Call any service |
| `home assistant services list` | List available services by domain |
| `home assistant events list` | List the most recent fired events |
| `home assistant history get <entity_id> [--since 1h]` | State history |
| `home assistant logbook list [--since 1h] [--entity <id>]` | Human-readable events |
| `home assistant calendars list` | List calendar entities |
| `home assistant calendars get <entity_id> [--start <iso>] [--end <iso>]` | Calendar events in a window |
| `home assistant template render <template>` | Render a Jinja2 template server-side |
| `home assistant camera snapshot <name\|entity_id> [--out path]` | JPEG snapshot from an HA camera |
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
| `home spotify artist albums <id\|uri> [--include-groups <types>]` | List an artist's albums |
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
| `home sonos play-mode set <room> [--shuffle] [--repeat] [--crossfade]` | Set play mode flags |
| `home sonos sleep-timer get <room>` | Read sleep timer (remaining seconds or off) |
| `home sonos sleep-timer set <room> <seconds>` | Start/cancel a sleep timer |
| `home sonos eq get <room>` | Read EQ (bass, treble, loudness) |
| `home sonos eq set <room> [--bass -10..10] [--treble -10..10] [--loudness on\|off]` | Set EQ |
| `home sonos group-volume get <room>` | Get per-member volumes in a group |
| `home sonos group-volume set <room> <level>` | Set volume on every group member |
| `home sonos group-mute <room> [--state on\|off\|toggle]` | Mute/unmute an entire group |
| `home sonos seek <room> <position>` | Seek to a position (seconds, "1:30", or "1:02:03") |
| `home sonos playlists list` | Sonos playlists (saved queues, SQ:) |
| `home sonos playlists get <title>` | Show tracks in a Sonos playlist |
| `home sonos playlists play <room> <title>` | Replace queue with a playlist and start playing |
| `home sonos library browse [--cat <category>] [--id <container>]` | Browse local music library by category |
| `home sonos library search <query> [--cat <category>]` | Search the local music library |
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

### `gmail`

Read-only Gmail access using the Gmail API and Google OAuth.
Setup: `home gmail configure` (set clientId/clientSecret), then `home gmail auth login` (opens a browser).

Works on consumer `@gmail.com` and Google Workspace accounts.

| Command | Purpose |
| --- | --- |
| `home gmail messages list --q <query> [--hydrate] [--limit N]` | List message ids matching a Gmail search query. `--q` supports Gmail search syntax: `from:`, `subject:`, `is:unread`, `newer_than:`, `has:attachment`, etc. `--hydrate` fetches From/Subject/Date/snippet per message in one call. |
| `home gmail messages get <id>` | Get a single message by id (full headers, body, attachments metadata) |
| `home gmail threads list --q <query> [--limit N]` | List thread ids matching a Gmail search query |
| `home gmail threads get <id>` | Get a thread and all of its messages by id |
| `home gmail labels list` | List all labels (system + user labels) |
| `home gmail labels get <id>` | Get a single label by id (includes message/thread counts) |
| `home gmail drafts list [--limit N]` | List draft ids (each carries a message id and threadId) |
| `home gmail drafts get <id>` | Get a single draft and its message by id |
| `home gmail profile get` | Mailbox profile: email address, message/thread totals, historyId |
| `home gmail auth login` | OAuth browser flow — store the refresh token |

### `gdrive`

Browse and fetch Google Drive files using the Drive API and Google OAuth.
Setup: `home gdrive configure` (set clientId/clientSecret), then `home gdrive auth login` (opens a browser).

| Command | Purpose |
| --- | --- |
| `home gdrive files list [--q <query>] [--limit N]` | List files. `--q` takes the Drive query language: `name contains 'report'`, `mimeType='application/pdf'`, `'<folderId>' in parents`, `modifiedTime > '2024-01-01'`. With no `--q`, lists all live (non-trashed) files. |
| `home gdrive files get <id\|name>` | Fetch full metadata for one file. Name resolves via a scoped search; ambiguous → lists candidates. |
| `home gdrive files download <id\|name> [--out <path>] [--stdout]` | Download a binary/uploaded file's bytes. Google-native docs (Docs/Sheets/Slides) cannot be downloaded — use `files export`. |
| `home gdrive files export <id> [--mime <type>] [--out <path>] [--stdout]` | Export a Google-native doc to another format. `--mime` accepts friendly aliases (`pdf`, `docx`, `xlsx`) or full MIME types. |
| `home gdrive auth login` | OAuth browser flow — store the refresh token |
| `home gdrive auth logout` | Forget the stored refresh token (revokes nothing server-side) |

### `gchat`

Read-only Google Chat access using the Chat API and Google OAuth.
**Requires a Google Workspace account** — the Chat API rejects consumer `@gmail.com` accounts.

| Command | Purpose |
| --- | --- |
| `home gchat spaces list [--filter <type>] [--limit N]` | List spaces the authenticated user belongs to |
| `home gchat spaces get <name>` | Get a single space by resource name or display-name match |
| `home gchat members list <space> [--limit N]` | List memberships (people and apps) in a space |
| `home gchat members get <space> <member>` | Get a single membership by resource name |
| `home gchat messages list <space> [--filter <f>] [--orderBy <o>] [--limit N]` | List messages in a space |
| `home gchat messages get <space> <message>` | Get a single message by resource name |

## Development

Requires Bun ≥ 1.3.

```bash
bun install
bun run typecheck
bun test
bun run dev -- unifi --help
bun run build:linux         # bun-linux-x64-baseline → dist/home-linux-x64
bun run build:mac           # bun-darwin-arm64       → dist/home-darwin-arm64
```

Adding a module: create `src/modules/<name>/index.ts` exporting a
`ModuleManifest`, add it to `src/registry.ts`, and `home skill install`
will write its SKILL.md alongside the others.

## License

MIT
