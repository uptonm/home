# `home`

> **Workstream test** — this is a pipeline validation edit.

A monolith CLI that gives you (and your local LLMs) uniform access to your
homelab services. One binary, one config root, one Claude skill per module.

Modules:

- **`unifi`** — UniFi Network controller (devices, clients, site health, PoE cycle, client block/unblock)
- **`protect`** — UniFi Protect (cameras with PTZ/LED/talkback, floodlights, motion/smart events, snapshots)
- **`assistant`** — Home Assistant (states, services, automations, scenes, scripts, history, logbook)
- **`spotify`** — Spotify catalog search (tracks, albums, artists, playlists) → Sonos-playable URIs
- **`sonos`** — Sonos players (playback, volume, queue, play URIs, now-playing, one-shot notifications)
- **`tts`** — text-to-speech to an MP3 (macOS `say` / Linux `espeak-ng`), for hand-off to Sonos notify

`spotify`, `sonos`, and `tts` are designed to pair: search the catalog with
`spotify` and hand the URI to `sonos play-uri`, or synthesize an announcement
with `tts` and push it through `sonos notify`.

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
| `home protect cameras get <id>` | A single camera by id |
| `home protect cameras ptz <camera> <direction>` | Pan / tilt / zoom a PTZ-capable camera |
| `home protect cameras led <camera> <ir\|spotlight> <on\|off\|auto>` | Control a camera's IR LED or flood light |
| `home protect cameras talkback <camera>` | Print the talkback (two-way audio) WebSocket URL |
| `home protect events list [--since 1h] [--limit 50]` | Recent events |
| `home protect events recent [--type motion\|smart] [--camera <id>] [--limit 10] [--since 24h]` | Pre-filtered, newest-first |
| `home protect lights <on\|off\|toggle> <light> [--brightness 0-100]` | Control a Protect floodlight |
| `home protect snapshot <camera> [--out path] [--stdout]` | JPEG snapshot (to file, or `--stdout` for raw bytes) |

### `assistant`

| Command | Purpose |
| --- | --- |
| `home assistant states list [--domain <d>]` | Entity states |
| `home assistant states search <query> [--domain <d>]` | Search entities by name / entity_id substring |
| `home assistant state get <entity_id> [--watch]` | Single entity (optionally poll for changes) |
| `home assistant light <on\|off\|toggle> <name\|id> [--brightness 0-100] [--color <c>]` | Control a light by name or id |
| `home assistant switch <on\|off\|toggle> <name\|id>` | Control a switch by name or id |
| `home assistant climate <name\|id> [--temperature <t>] [--mode <m>]` | Set thermostat temp / HVAC mode |
| `home assistant scene <name\|id>` | Activate a scene by name or id |
| `home assistant script <name\|id>` | Run a script by name or id |
| `home assistant service call <domain>.<service> [--data <json>]` | Call any service |
| `home assistant automation trigger automation.<id>` | Fire an automation |
| `home assistant history get <entity_id> [--since 1h]` | State history |
| `home assistant logbook list [--since 1h] [--entity <id>]` | Human-readable events |

### `spotify`

| Command | Purpose |
| --- | --- |
| `home spotify search <query> [--type <types>] [--limit N] [--market <code>]` | Search the catalog (`--type` = comma-separated subset of track,album,artist,playlist); returns Sonos-playable URIs |

### `sonos`

| Command | Purpose |
| --- | --- |
| `home sonos players list` | All players discovered on the network |
| `home sonos groups list` | Sonos groups (coordinator + members) |
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
| `home sonos play-uri <room> <uri> [--sn N]` | Replace the transport with a URI and play |
| `home sonos favorites list` | Sonos favorites (My Sonos) |
| `home sonos notify <room> [--file <path> \| --url <url>] [--volume <v>] [--timeout <s>] [--delete-after]` | One-shot clip/announcement, then restore what was playing |
| `home sonos spotify-accounts list` | Spotify accounts on the household (the `sn` for `--sn`) |

### `tts`

| Command | Purpose |
| --- | --- |
| `home tts synth <text> [--voice <name>] [--rate <wpm>] [--out <path>]` | Synthesize text to an MP3 (macOS `say` / Linux `espeak-ng`, piped through `lame`) |

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
