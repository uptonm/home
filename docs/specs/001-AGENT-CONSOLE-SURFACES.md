---
plans:
  - 001-DECLINE-AGENT-UI-LIBRARIES
---

# Hermes agent console surfaces

Which web surfaces render Hermes agent sessions on this host, which of them is
live, and what a component has to satisfy to appear in one.

Unqualified `apps/*` paths below are relative to `uptonm/agents`, not to this
repo. `uptonm/home` contains only `apps/home` and `apps/site`; there is no
`home/apps/web`.

This document does **not** restate the gateway contract or what the chat surface
renders. Those facts live in the `uptonm/agents` repo and are cited here:

| Fact | Where it lives |
|---|---|
| Gateway routes, auth, event vocabulary, run register scope | [`agents/docs/specs/000-HERMES-GATEWAY.md`] |
| What `/chat` renders, status/mark vocabulary, live-turn transport | [`agents/docs/specs/001-CHAT.md`] |
| Tool registry, toolsets, grants | [`agents/docs/specs/007-TOOLS.md`] |
| Web shell, design gates | [`agents/docs/specs/009-WEB-SHELL.md`] |

[`agents/docs/specs/000-HERMES-GATEWAY.md`]: https://github.com/uptonm/agents/blob/main/docs/specs/000-HERMES-GATEWAY.md
[`agents/docs/specs/001-CHAT.md`]: https://github.com/uptonm/agents/blob/main/docs/specs/001-CHAT.md
[`agents/docs/specs/007-TOOLS.md`]: https://github.com/uptonm/agents/blob/main/docs/specs/007-TOOLS.md
[`agents/docs/specs/009-WEB-SHELL.md`]: https://github.com/uptonm/agents/blob/main/docs/specs/009-WEB-SHELL.md

What this document owns is the thing none of those record: **there is more than
one console, only one of them is running, and the difference is not visible from
any of their READMEs.**

## The three surfaces

| Surface | Stack | State |
|---|---|---|
| `apps/web` in `uptonm/agents` | Next 16.3, React 19.2, Tailwind v4.3, Base UI, Bun, Biome | **Live.** `agents-web` container, `127.0.0.1:4700`, `agents.uptonm.io` |
| `hermes dashboard` | Upstream Python + prebuilt `hermes_cli/web_dist` | **Live.** `0.0.0.0:9119`, `dashboard.hermes.uptonm.io`, basic auth |
| `~/hermes-webui` | Python stdlib `http.server`, ~90k lines vanilla JS | **Decommissioned.** Not running, no unit, no route |

A fourth exists but never ran here: `apps/hermes-agent/apps/desktop` is upstream
Nous Research's Electron shell (Vite, npm, shadcn/Radix, `components.json`,
tabler icons). It is the desktop client that talks to `:9119`. It is upstream
code inside our fork, on a toolchain the house rules forbid — npm, not Bun.

### `apps/web` is the console

`@uptonm/web`, in the monorepo we own. The `/chat` surface reads the Hermes
corpus over the gateway and takes turns in it. It carries 812 unit tests plus 24
integration tests, and three design gates — focus indicators, touch targets,
tokens.

Its transcript is a discriminated union, `ThreadEntry` in
`apps/web/src/lib/hermes/message-view.ts`:

```ts
| { kind: 'operator'; id: number; at: number | null; text: string }
| { kind: 'agent'; id: number; at: number | null; text: string }
| { kind: 'reasoning'; id: number; at: number | null; text: string }
| { kind: 'tool'; id: number; at: number | null; name: string
    call: ToolCallLine | null; result: string | null }
| { kind: 'compaction'; hidden: number }
| { kind: 'note'; id: number; at: number | null; displayKind: string; text: string }
```

Six kinds. Any component library proposing to render a Hermes turn is proposing
to render that union, and nothing wider — there is no diff kind, no token kind,
and no todo kind, because the data for them does not exist.

A tool renders as one mono line — the provider's tool name, an outcome read from
a truthy `error`, and collapsible raw argument and result strings. There is no
per-tool card.

### `~/hermes-webui` is dead, and the record of its death is only in Caddy

A direct clone of `nesquena/hermes-webui` — **not a fork we own**, no `uptonm`
remote. Upstream is MIT, 17.4k stars, 2,397 forks, a 181 MB repo taking on the
order of seven commits a day.

Its own `package.json` states the architecture: *"the app remains pure Python +
vanilla JS with no bundler."* Concretely: `server.py` is
`http.server.BaseHTTPRequestHandler` + `ThreadingHTTPServer` with no web
framework, ~100k lines of Python under `api/` hand-dispatching 226 paths out of
five `handle_get`/`handle_post`/… functions, and ~90k lines of vanilla JS under
`static/` loaded as plain `<script>` tags in dependency order — `ui.js` alone is
20,668 lines, `panels.js` 13,238, `sessions.js` 9,392. The only npm dependency
in the tree is ESLint, used as a runtime-error guard and explicitly not a build
step.

It renders more than `apps/web` does: diffs, thinking cards, todo state,
terminal panes, skills, compression recovery, approval prompts.

It has not served anything since **2026-08-06**. The Caddy backup pair
`Caddyfile.pre-agents-migrations.20260806_223251.bak` (has
`hermes.uptonm.io { reverse_proxy http://localhost:8787 }`) and
`Caddyfile.pre-rosetta.20260806_233038.bak` (does not) bracket the removal to a
one-hour window. Nothing listens on 8787, no systemd unit references it, and its
`.env` still claims Caddy proxies it.

Its git index records an unresolved merge for `static/panels.js` — `UU`, with no
`MERGE_HEAD` and no conflict markers left in the working-tree file. It is a
stale index, not work in progress.

**The repository is read-only.** Nothing writes to it, resolves it, or runs it.

## What a component must satisfy to enter `apps/web`

Four constraints, all mechanically enforced, all discovered by reading the repo
rather than stated anywhere as a policy.

**1. The shadcn token vocabulary is banned by a passing test.**
`apps/web/__tests__/tokens.test.ts` asserts, under the name *"the shadcn
vocabulary is gone, not aliased"*, that `globals.css` contains none of
`--primary`, `--secondary`, `--muted`, `--destructive`, `--popover`, `--card`.
The token layer is role-named instead — `--ground`, `--surface`, `--raised`,
`--sunken`, `--bubble`, `--line`, `--field`, `--text`, `--text-2`, `--text-3`,
`--live`, `--accent`, `--danger`, `--ok`, `--ring`, `--solid`, `--on-solid`,
`--scrim` — and every role is overridden by value in the light theme.

A component written against `bg-muted` or `text-muted-foreground` does not
degrade in this project. The utility resolves to nothing, and restoring it means
reintroducing exactly the six custom properties the test forbids.

**2. There is no `components.json`.** `apps/web` is not a shadcn-initialised
project, so no registry `add` command can target it without first running
`shadcn init` — which writes the banned vocabulary.

**3. The primitive library is Base UI, not Radix.** `@base-ui/react` is a direct
dependency and `@radix-ui/*` appears nowhere in the workspace.

**4. Tool names are Hermes', not Claude Code's.** The registry in
`apps/hermes-agent/tools/` holds 89 tools under snake_case names —
`execute_code`, `patch`, `read_file`, `terminal`, `process`, `memory`,
`delegate_task`, `computer_use`, and the `browser_*`, `kanban_*` and `ha_*`
families. There is no `Bash`, `Edit`, `Read`, `Grep`, `Glob` or `TodoWrite`.

## What the corpus cannot support

Two features that agent-UI libraries lead with have no data behind them here, and
building either would mean inventing a number.

**Token and context usage.** Per-message `token_count` is null on every row of
the live corpus; the session counters are cumulative billing across every turn
rather than the occupancy of one window; and no context-window size is recorded
anywhere. `apps/web/src/components/chat/chat-composer.tsx` records this as the
reason its context meter is absent.

**Diffs.** `ThreadEntry` carries a tool result as an opaque `string`. Hermes'
`patch` tool emits no structured hunk data comparable to Claude Code's
`structuredPatch`, so a diff component would have to parse prose.

## The standing position on third-party agent-UI component libraries

> **NEEDS APPROVAL** — [`001-DECLINE-AGENT-UI-LIBRARIES`](../plans/001-DECLINE-AGENT-UI-LIBRARIES.md)

None is adopted. Five were evaluated on 2026-08-17 — assistant-ui, tool-ui,
agent-elements, nexus-ui, simple-ai, all MIT, all license-verified from the
LICENSE file rather than a badge. The evaluation and its reasoning are in the
plan; the conclusion is that the blocker is not any library's quality but the
four constraints above, three of which every candidate violates and the fourth of
which makes the one genuinely differentiated feature — per-tool cards — non-
transferable.

The position is a default, not a ban. It is revisited by a new plan, not by
re-running the evaluation.

> **NEEDS APPROVAL** — [`001-DECLINE-AGENT-UI-LIBRARIES`](../plans/001-DECLINE-AGENT-UI-LIBRARIES.md)

`apps/web` repairs incomplete markdown mid-stream with `remend`, so a code fence
opened by a delta renders as a code block before its closing fence arrives.
