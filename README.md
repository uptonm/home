# `home`

A monolith CLI that gives you (and your local LLMs) uniform access to your
homelab services. One binary, one config root, one Claude skill per module.

Modules:

- **`unifi`** — UniFi Network controller (devices, clients, site health, PoE cycle, client control)
- **`protect`** — UniFi Protect (cameras with PTZ/LED/talkback, floodlights, motion/smart events, snapshots)
- **`assistant`** — Home Assistant (states, services, automations, scenes, scripts, history, logbook)
- **`spotify`** — Spotify catalog search (tracks, albums, artists, playlists) → playable URIs
- **`sonos`** — Sonos players (playback, volume, grouping, queue, play URIs, one-shot notifications)
- **`tts`** — text-to-speech to an audio file (macOS `say`), for hand-off to Sonos notify

`spotify`, `sonos`, and `tts` are designed to pair: search the catalog with
`spotify`, hand the URI to `sonos play-uri`, or synthesize an announcement with
`tts` and push it through `sonos notify`.

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
home configure-all              # interactive configure for every module in turn
home skill install              # write ~/.claude/skills/home-<module>/SKILL.md (one per module)
home doctor                     # status across every configured module
```

You can also configure modules one at a time — `home unifi configure`,
`home spotify configure`, etc. `sonos` needs **no** configuration to find
players over SSDP multicast; configure it only for cross-VLAN discovery
(seed host / subnet scan).

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
uri=$(home spotify search "alvvays archie" --limit 1 --json | jq -r '.[0].uri')
home sonos play-uri "Patio" "$uri" --now
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
- `home config` prints the resolved paths and per-module config (secrets redacted)

Rotate / migrate:

```bash
home unifi configure --rotate      # re-prompt secrets only
home unifi configure --force       # re-prompt everything

home secrets export --out ~/home-secrets.json
home secrets import --in  ~/home-secrets.json
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
| `home unifi devices get <mac>` | One device by MAC or name, full detail |
| `home unifi devices poe-cycle <switch> <port>` | Power-cycle PoE on a switch port (reboot an AP or camera) |
| `home unifi clients list` | Connected clients (wired + wireless) |
| `home unifi clients control <block\|unblock\|reconnect\|forget> <target>` | Block / unblock / reconnect / forget a client by MAC or name |
| `home unifi site info` | Site identity and raw stats |
| `home unifi site health` | Per-subsystem health (WAN, LAN, WLAN, WWW) |

### `protect`

| Command | Purpose |
| --- | --- |
| `home protect cameras list` | All Protect cameras |
| `home protect cameras get <id>` | One camera by id or name, full detail |
| `home protect cameras ptz <camera> <preset\|goto\|home> [value]` | Control a PTZ camera (preset slot, `pan,tilt,zoom`, or home) |
| `home protect cameras led <camera> <on\|off>` | Toggle a camera's status LED |
| `home protect cameras talkback <camera> <source>` | Play audio through a camera speaker from a file or URL |
| `home protect events list [--since 1h] [--limit 50] [--type motion\|smart\|ring]` | Recent events |
| `home protect events recent --type motion\|smart\|ring [--camera <id>] [--limit 10]` | Filtered, newest-first |
| `home protect lights [target] [--state on\|off] [--brightness 1-6]` | List floodlights, or turn one on/off |
| `home protect snapshot <camera> [--out path] [--full]` | JPEG snapshot (to file or stdout) |

### `assistant`

| Command | Purpose |
| --- | --- |
| `home assistant states list [--domain <d>]` | Entity states |
| `home assistant states search <query> [--domain <d>] [--limit 25]` | Search entities by name or entity_id substring |
| `home assistant state get <entity_id>` | Single entity |
| `home assistant light <on\|off\|toggle> <name\|id> [--brightness 0-100] [--color <c>]` | Control a light by name or id |
| `home assistant switch <on\|off\|toggle> <name\|id>` | Control a switch by name or id |
| `home assistant climate <name\|id> [--temperature <t>] [--mode <m>]` | Set thermostat temp / HVAC mode |
| `home assistant scene activate <name\|id>` | Activate a scene by name or id |
| `home assistant script run <name\|id>` | Run a script by name or id |
| `home assistant service call <domain>.<service> [--data <json>]` | Call any service |
| `home assistant automation trigger automation.<id>` | Fire an automation |
| `home assistant history get <entity_id> [--since 1h]` | State history |
| `home assistant logbook list [--since 1h] [--entity <id>]` | Human-readable events |

### `spotify`

| Command | Purpose |
| --- | --- |
| `home spotify search <query> [--type track\|album\|artist\|playlist] [--limit 10] [--market <code>]` | Search the catalog; resolves each match to a playable URI |

### `sonos`

| Command | Purpose |
| --- | --- |
| `home sonos players list` | Discovered players / rooms |
| `home sonos play <room>` | Resume playback |
| `home sonos pause <room>` | Pause playback |
| `home sonos next <room>` | Skip to the next track |
| `home sonos prev <room>` | Skip to the previous track |
| `home sonos volume <room> [level]` | Get or set volume 0-100 (omit to read) |
| `home sonos mute <room> [on\|off]` | Mute / unmute (omit to mute) |
| `home sonos group <coordinator> <members>` | Group rooms onto a coordinator (members comma-separated) |
| `home sonos ungroup <room>` | Detach a room from its group |
| `home sonos queue list <room>` | Show the current queue |
| `home sonos queue clear <room>` | Clear the queue |
| `home sonos play-uri <room> <uri> [--now]` | Play a Spotify URI / http stream (`--now` replaces current) |
| `home sonos notify <room> <uri> [--volume <v>] [--delete-after]` | Play a one-shot clip/announcement, then restore what was playing |
| `home sonos spotify-accounts list` | Spotify accounts available on Sonos (multi-account households) |

### `tts`

| Command | Purpose |
| --- | --- |
| `home tts synth <text> [--file <path>] [--out <path>] [--voice <name>] [--format mp3\|wav]` | Synthesize text to an audio file (MP3 by default; macOS `say`) |

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
