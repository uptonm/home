# `home` — Monolith CLI for Homelab Services

## Context

You want a single CLI (`home`) that gives both you and local LLMs uniform access to your homelab services — starting with **Unifi Network**, **Unifi Protect**, and **Home Assistant**. The CLI is a monolith with a module-per-service layout. Each module owns its own configure step and persists config/secrets so tokens don't need to be re-entered each session. Every module auto-generates a Claude skill so an LLM can pick up a module and use it immediately.

The repo will live at `~/Projects/home`, ship from GitHub with CI/CD, and your Proxmox compute nodes (no-AVX Linux x86_64) and your Mac will install pre-built versioned binaries.

## Architectural decisions (locked)

| Area | Decision |
| --- | --- |
| Runtime | Bun + TypeScript |
| CLI framework | `citty` (UnJS), static `subCommands` map |
| Module layout | Static folder-per-module under `src/modules/`, registered in `src/index.ts` |
| Config root | `~/.config/home/` (XDG-style; matches your existing chezmoi/gh/git pattern) |
| Secrets | OS keyring (macOS Keychain / libsecret) via `@napi-rs/keyring`, file fallback at `~/.config/home/secrets.json` mode 0600 |
| Skills | One skill per module, auto-generated to `~/.claude/skills/home-<module>/SKILL.md` |
| Build targets | `bun-linux-x64-baseline` (no-AVX safe for your PVE host) + `bun-darwin-arm64` |
| API approach | Mixed — `unifi-protect` SDK for Protect, thin `fetch` clients for Unifi Network and Home Assistant REST |

## Repository layout

```
~/Projects/home/
  .github/workflows/
    ci.yml                  # typecheck + test on push/PR
    release.yml             # build + publish binaries on tag v*
  src/
    index.ts                # citty root, registers modules
    core/
      types.ts              # Module, CommandManifest interfaces
      config.ts             # load/save ~/.config/home/* JSON
      secrets.ts            # keyring abstraction + file fallback
      output.ts             # --json / table / log formatters
      paths.ts              # XDG path resolution
      skill.ts              # SKILL.md generator from manifests
    modules/
      unifi/
        index.ts            # subcommand + manifest export
        configure.ts        # interactive setup
        client.ts           # thin fetch-based UniFi Network client
        commands/
          devices.ts
          clients.ts
          site.ts
      protect/
        index.ts
        configure.ts
        client.ts           # wraps unifi-protect SDK
        commands/
          cameras.ts
          events.ts
          snapshot.ts
      assistant/
        index.ts
        configure.ts
        client.ts           # thin Home Assistant REST client
        commands/
          states.ts
          service.ts
          automation.ts
  scripts/
    install.sh              # curl | sh installer (detects OS/arch)
  package.json
  tsconfig.json
  bun.lockb
  README.md
```

## Module contract

Each `modules/<name>/index.ts` exports two things:

```ts
// 1. The citty subcommand tree
export default defineCommand({ ... })

// 2. A manifest the skill generator and `home doctor` read
export const manifest: ModuleManifest = {
  name: 'unifi',
  description: 'UniFi Network controller — devices, clients, sites',
  requiresConfig: true,
  configSchema: { ... },          // for `home <mod> configure` prompts
  commands: [
    { name: 'devices list', description: '...', args: [...], examples: [...] },
    ...
  ],
}
```

`src/index.ts` imports each module statically and registers it on the citty root, so `bun build --compile` can fully bundle. Adding a new module = create the folder + add one line to the registry.

## Baked-in subcommands every module gets

- `home <mod> configure` — interactive prompts based on `configSchema`; writes non-secret values to `~/.config/home/modules/<mod>.json`, stores secrets via keyring
- `home <mod> status` — connectivity/auth health check
- `home <mod> skill` — regenerates that module's `SKILL.md`

Plus module-specific commands (see below).

## Top-level subcommands

- `home init` — creates `~/.config/home/` skeleton
- `home configure` — runs every registered module's configure flow
- `home skill install` — writes/refreshes all `~/.claude/skills/home-<mod>/` skills
- `home doctor` — runs `status` across all configured modules
- `home --version`

## Config and secrets

- `~/.config/home/config.json` — global: log level, default output format
- `~/.config/home/modules/<name>.json` — non-secret per-module config (URLs, site IDs)
- Secrets via `@napi-rs/keyring`:
  - service: `home-cli`
  - account: `<module>:<key>` (e.g. `unifi:apiKey`, `assistant:token`)
  - On Linux without libsecret, fall back to `~/.config/home/secrets.json` mode 0600 after asking the user to confirm
- `core/secrets.ts` exposes `getSecret(module, key)` / `setSecret(module, key, value)` — modules never touch storage directly

## LLM-friendly output

- Every command accepts `--json` for structured output (silent otherwise)
- Default human output: short tables / single-line summaries
- Exit codes: `0` ok, `1` user error, `2` system error, `3` not configured
- Global `--quiet` and `--verbose`
- Errors emitted to stderr; JSON output goes to stdout cleanly so LLMs can pipe-parse

## Auto-generated skills

`core/skill.ts` reads each module's `manifest` and writes:

```
~/.claude/skills/home-<module>/SKILL.md
```

With frontmatter:
```yaml
---
name: home-<module>
description: <manifest.description> — invoke via the `home <module>` CLI
---
```

Body covers: what the module does, the configure step, a command reference table generated from `manifest.commands`, worked `--json` examples, and a "when to use this skill" section. Re-running `home skill install` is idempotent.

## Build and distribution

- Dev: `bun run dev -- <args>` runs `src/index.ts` directly
- Release builds (in CI):
  - `bun build --compile --target=bun-linux-x64-baseline src/index.ts --outfile dist/home-linux-x64`
  - `bun build --compile --target=bun-darwin-arm64 src/index.ts --outfile dist/home-darwin-arm64`
- The `-baseline` Linux target compiles without AVX, which matches your PVE host's CPU (see `[[homelab-proxmox]]` memory)
- `scripts/install.sh` detects OS+arch, fetches the matching asset from the latest GitHub release, drops it in `~/.local/bin/home` (or `/usr/local/bin/home` with sudo)

## CI/CD

- `.github/workflows/ci.yml` — on push/PR: `bun install`, `bun run typecheck`, `bun test`
- `.github/workflows/release.yml` — on tag `v*`: build both binaries on the matching runners (`ubuntu-latest`, `macos-14`), create a GitHub Release, attach binaries + `install.sh`
- Semantic version tags drive releases; `home --version` is baked in at build time

## Per-module first-pass commands

**`unifi`** (Unifi Network, thin HTTP client)
- Configure prompts: controller URL, API key (UniFi OS 9.x official API), site name
- `devices list`, `devices get <mac>`, `clients list`, `site info`

**`protect`** (Unifi Protect, via `unifi-protect` npm package)
- Configure prompts: controller URL, local Protect username, password
- `cameras list`, `events list [--since]`, `snapshot <camera> [--out path]`

**`assistant`** (Home Assistant, thin REST client)
- Configure prompts: HA base URL, long-lived access token
- `states list [--domain]`, `state get <entity_id>`, `service call <domain>.<service> [--data json]`, `automation trigger <entity_id>`

## Critical files to create (in order)

1. `package.json`, `tsconfig.json`, `.gitignore` — Bun + TS scaffolding
2. `src/core/types.ts` — `Module` and `CommandManifest` types
3. `src/core/paths.ts`, `src/core/config.ts`, `src/core/secrets.ts`, `src/core/output.ts` — primitives every module uses
4. `src/core/skill.ts` — SKILL.md template + writer
5. `src/index.ts` — citty root + `init` / `configure` / `skill install` / `doctor`
6. One module end-to-end (`unifi`) to validate the contract before duplicating
7. `protect` and `assistant` modules
8. `.github/workflows/ci.yml`, `release.yml`
9. `scripts/install.sh`
10. `README.md` with install + quick-start

## Verification

After build:
- `bun install && bun run typecheck` — clean
- `bun test` — passes (unit-test the core helpers + manifest generation; mock HTTP in module clients)
- `bun run dev -- --help` — citty shows all three modules
- `bun run dev -- init` — creates `~/.config/home/` structure
- `bun run dev -- unifi configure` — interactive flow, secret lands in macOS Keychain (`security find-generic-password -s home-cli -a 'unifi:apiKey'` confirms)
- `bun run dev -- unifi status` — exits 0 against the live controller
- `bun run dev -- unifi devices list --json | jq .` — well-formed JSON
- `bun run dev -- skill install` — writes `~/.claude/skills/home-unifi/SKILL.md` etc.; opening a fresh Claude Code session lists them under available skills
- `bun build --compile --target=bun-darwin-arm64 src/index.ts --outfile /tmp/home` then `/tmp/home --help` — single binary works
- Tag `v0.0.1`, push, watch CI produce both binaries, attach to release; install on a Proxmox LXC via `install.sh`, run `home assistant states list`
