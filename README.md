# `home`

A monolith CLI that gives you (and your local LLMs) uniform access to your
homelab services. One binary, one config root, one Claude skill per module.

Modules in v0.1:

- **`unifi`** — UniFi Network controller (devices, clients, site health)
- **`protect`** — UniFi Protect (cameras, motion / smart events, snapshots)
- **`assistant`** — Home Assistant (states, services, automations, history, logbook)

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
home unifi configure            # interactive prompts; writes config + secret
home protect configure
home assistant configure
home skill install              # write ~/.claude/skills/home-{unifi,protect,assistant}/SKILL.md
home doctor                     # status across every configured module
```

Every command takes `--json` for clean machine-readable output:

```bash
home unifi devices list --json | jq '.[] | select(.type=="uap")'
home protect events recent --type motion --limit 5 --json
home assistant logbook list --since 24h --json
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
| `home unifi devices get <mac>` | One device with full detail |
| `home unifi clients list` | Currently-connected clients |
| `home unifi site info` | Site identity and raw stats |
| `home unifi site health` | Per-subsystem health (WAN, LAN, WLAN, WWW) |

### `protect`

| Command | Purpose |
| --- | --- |
| `home protect cameras list` | All Protect cameras |
| `home protect cameras get <id>` | One camera with full detail |
| `home protect events list [--since 1h] [--limit 50]` | Recent events |
| `home protect events recent --type motion\|smart [--camera <id>] [--limit 10]` | Filtered, newest-first |
| `home protect snapshot <camera> [--out path]` | JPEG snapshot |

### `assistant`

| Command | Purpose |
| --- | --- |
| `home assistant states list [--domain <d>]` | Entity states |
| `home assistant state get <entity_id>` | Single entity |
| `home assistant light <on\|off\|toggle> <name\|id> [--brightness 0-100] [--color <c>]` | Control a light by name or id |
| `home assistant switch <on\|off\|toggle> <name\|id>` | Control a switch by name or id |
| `home assistant climate <name\|id> [--temperature <t>] [--mode <m>]` | Set thermostat temp / HVAC mode |
| `home assistant service call <domain>.<service> [--data <json>]` | Call a service |
| `home assistant automation trigger automation.<id>` | Fire an automation |
| `home assistant history get <entity_id> [--since 1h]` | State history |
| `home assistant logbook list [--since 1h] [--entity <id>]` | Human-readable events |

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
