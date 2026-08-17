---
plans: []
---

# Where work is tracked

Four systems hold work on this machine. They are not four views of one backlog — three
track what a person intends to do, and the fourth is a queue a machine drains. Mistaking
the fourth for the first three is what makes a board look missing when one is already
running.

## The live system: numbered plans, executed as pull requests

Work that is actually moving lives as `docs/specs/` and `docs/plans/` inside the repo it
changes, under the convention in `~/.claude/CLAUDE.md`. A plan is picked up, executed on
a branch, and lands as a pull request; `## Landed` on the plan is the record.

`uptonm/agents` is where this is densest — fourteen specs, thirty-plus plans, and
`docs/plans/ORDER.md` holding the execution graph that the numbers do not carry. Pull
requests merged there on 2026-08-17 are plan-numbered on their face (`docs(033): the
ordering edge, and the drain 028 dropped`). This repo carries the same convention; `docs/`
here begins with this spec.

**Graphite is transport, not a tracker.** `gt` stacks a branch chain and submits it; it
holds no state once the stack lands. Nothing is tracked *in* Graphite, and nothing is lost
when a stack drains. It is in active use; whether a stack is open in this repo at any
moment says nothing about that.

## Linear holds the human backlog

Linear is the tracker for human-intended work, and it is in active use. What follows is
scoped to this repo and this host only, and is not a claim about Linear generally.

Team `UPT` holds 47 issues: 39 in `Backlog`, 8 `Done`, every one of the 39 under project
`Atlas` — the project this repo's work moved away from. Nothing in *that team* has moved
since 2026-05-30.

`home linear` reads and writes Linear (`apps/home/src/modules/linear/`). The standalone
`linear` CLI that the `linear` skill drives is **not installed on this host** — `which
linear` finds nothing. Deferred review items originating here are therefore written into
pull request bodies rather than filed as issues, which is a gap in this box's tooling
rather than a property of the tracker.

## The Hermes task backlog is live infrastructure

`~/.hermes/kanban.db` is a running agent work queue, not residue from a dismantled feature.
Its kernel, schema, invariants, and status vocabulary are specified in
`~/Projects/agents/docs/specs/002-TASK-BACKLOG.md` and implemented in
`apps/hermes-agent/hermes_cli/kanban_db.py`. That spec is the one place those facts live
and this one does not restate them.

Four independent signals show it running:

- `hermes-gateway.service` is an `enabled` systemd user unit. Its process
  (`python -m hermes_cli.main gateway run`) has been up since 2026-08-12 21:43 and holds
  `~/.hermes/kanban/.dispatcher.lock`, the machine-global singleton lock taken in
  `gateway/kanban_watchers.py`.
- The dispatcher watcher is spawned unconditionally at gateway boot and self-gates on
  `kanban.dispatch_in_gateway`, which **defaults to true in code and is explicitly `true`
  in `~/.hermes/config.yaml`**. It ticks every 60 seconds and spawns workers as detached
  `subprocess.Popen` children.
- `kanban.db-wal` and `kanban.db-shm` are recreated continuously; both carried the current
  minute's timestamp during this investigation, four days after the last task completed.
- The schema was migrated on 2026-08-12 by `_migrate_task_links_v2`, evidenced by the
  `kanban.db.pre-links-v2.20260812_162326.bak` snapshot taken across the `task_links`
  rewrite that added edge kinds.

The live configuration is `dispatch_in_gateway: true`, `dispatch_interval_seconds: 60`,
`failure_limit: 2`, `orchestrator_profile: worker`, `default_assignee: worker`,
`max_in_progress_per_profile: 1`, `auto_decompose: false`. The `worker` profile runs
`claude-opus-5` over the local `provider: custom` proxy at `127.0.0.1:8722`.

**The swarm is gone; this is not the swarm.** Dependency runs the other way:
`hermes_cli/kanban_swarm.py` imports the kernel and states it "intentionally does not
introduce a second scheduler", writing its topology into existing tables. The four
load-bearing kernel files — `kanban_db.py`, `gateway/kanban_watchers.py`,
`tools/kanban_tools.py`, `plugins/kanban/dashboard/plugin_api.py` — contain **zero**
functional references to swarm. Deleting the swarm profiles removed a topology preset and
its worker identities; it could not and did not disable the dispatcher, the kernel, or the
board.

What changed on 2026-08-12 was routing, not enablement: `orchestrator_profile` and
`default_assignee` moved from `''` to `worker`. Before that the dispatcher was already
ticking but skipping every unassigned task.

### What it holds

Nine tables. Row counts as of 2026-08-17:

| Table | Rows | What it carries |
|---|---|---|
| `tasks` | 47 | one row per unit of work — status, assignee, priority, claim lease, failure count, workspace |
| `task_events` | 914 | append-only log with autoincrement id; the cursor a live stream reads |
| `task_runs` | 72 | one row per execution attempt, with outcome and heartbeat |
| `task_comments` | 60 | worker and operator notes |
| `task_links` | 24 | dependency edges, `requires` or `observes` |
| `task_attachments` | 0 | unused |
| `task_revisions` | 0 | unused |
| `kanban_notify_subs` | 0 | unused |
| `sqlite_sequence` | 3 | SQLite bookkeeping |

**The board is drained, not abandoned.** All 47 tasks are terminal — 29 `archived`, 18
`done`. Zero are open in any state. 43 were created in June 2026 under the swarm; the four
created since are August worker-mode runs, three smoke tests and one real (`t_7ba540fe`,
*Execute plan 017-WEB-MODULE-SHELL*, completed 2026-08-13 22:10, which opened a pull
request against `uptonm/agents`).

An empty board and a dead board are identical in the data and opposite in meaning. This
one is empty.

### It is not a human tracker

The `tasks` row is shaped for a supervisor process, not a person: `claim_lock`,
`claim_expires`, `worker_pid`, `last_heartbeat_at`, `consecutive_failures`,
`max_runtime_seconds`, `model_override`, `provider_override`, `reasoning_effort`. Cards are
assigned to agent profiles rather than people — `reviewer` (22), `builder` (9), `worker`
(4), `tech-lead` (2).

Nothing a person wants to remember belongs here, and nothing here would survive being
edited by hand while a dispatcher holds a lease on it.

## It already has four board surfaces

This is the fact that decides everything below: **a working kanban board ships with Hermes
and is serving right now.**

**The web board.** `plugins/kanban/dashboard/` is a *bundled* dashboard plugin — its
`manifest.json` claims the `/kanban` tab, and bundled plugins bypass the `plugins.enabled`
allow-list, so only an explicit disable would stop it. `config.yaml` disables nothing. The
built artifact is `dist/index.js` (189 KB) plus `dist/style.css` (45 KB): a plain IIFE with
no build step, taking React and shadcn primitives from `window.__HERMES_PLUGIN_SDK__` and
doing card movement with HTML5 drag-and-drop. It offers drag-drop across columns, comment
threads, and per-profile run visibility.

`hermes-dashboard.service` is an `enabled` systemd user unit serving port 9119, and Caddy
reverse-proxies `dashboard.hermes.uptonm.io` to `127.0.0.1:9119`. The board is therefore
already reachable at **`https://dashboard.hermes.uptonm.io/kanban`**, behind the same
site block and TLS as every other homelab service.

**Its API.** `plugin_api.py` mounts roughly forty routes under `/api/plugins/kanban/` —
board and task reads, create, patch, delete, bulk edit, comments, links, attachments,
diagnostics, active workers, run inspect and terminate, reclaim, reassign, projects, boards
CRUD, profiles, decompose, a `POST /dispatch` nudge — plus `WS /events` for live tailing.

**The desktop board.** `apps/desktop/src/plugins/kanban/` carries the TSX port —
`board.tsx` (52 KB) and `drawer.tsx` (33 KB) — with drag-to-move, multi-select, a bulk
action bar, right-click actions and a detail drawer.

**The CLI.** `hermes kanban` exposes roughly fifty subcommands from
`hermes_cli/kanban.py`, including `list`, `show`, `create`, `edit`, `assign`, `link`,
`comment`, `block`, `promote`, `archive`, `tail`, `watch`, `runs`, `stats`, `dispatch`,
`doctor` and `repair`. It is also a slash command inside chat.

Agents reach the same kernel through twelve in-process `kanban_*` tools in the
`hermes-tools` toolset, gated on `HERMES_KANBAN_TASK`. There is no MCP surface for the
board and none is needed — `hermes-webui/mcp_server.py` exposes seven tools, all
project/session management, none of them kanban.

## A second-generation board is already specified

`~/Projects/agents/docs/specs/003-TASK-UI.md` owns the *next* operator view: a `/tasks`
page ordered by the dispatcher's own effective-priority rule, a per-conversation
dependency-graph drawer at `/chat/[sessionId]`, an eight-word screen vocabulary mapped onto
the kernel's states, and a `GET /api/tasks/events?cursor=` SSE stream keyed on the
append-only event id. It is scheduled behind plans `006-TASK-SEAM` and `007-TASK-SURFACES`,
which `ORDER.md` places after the DAG-integrity work.

That spec also fixes the architecture the plugin board predates: the new surface lives in
`~/Projects/agents/apps/web`, is containerised, and **never reads `~/.hermes/kanban.db`
directly** — everything travels over the Hermes gateway, and every write route calls the
same kernel function the agent's own tools call, so one behaviour never becomes two.

The board question is therefore not open. It is owned, twice over, in another repository.

## This repo runs no board, and adds none

`~/Projects/home` contains no kanban code, no board dependency, and no reference to one —
`kanban`, `veritas`, `kibo`, `roadmap-ui` and `dnd-kit` all return nothing across `apps/`,
`packages/` and `docs/`.

Two structural facts keep it that way.

**`apps/site` is not on the LAN.** It is the Fumadocs marketing and documentation site for
`https://home.uptonm.dev`, deployed to Vercel. It has no route to a SQLite file on this
host. Embedding a board there would require the homelab-to-Vercel tunnel that has been
designed and never built.

**Both house front-ends are Base UI, not Radix.** `apps/site` runs `@base-ui/react` ^1.6.0
with shadcn 4 in the `base-nova` style on React 19.2.4 and Next 16.2.10;
`~/Projects/agents/apps/web` runs `@base-ui/react` ^1.7.0 on React 19.2.8 and Next 16.3.0.
Neither carries a Radix package. A component registry built on Radix cannot be dropped into
either without importing a second, parallel primitive library.

A third-party board would also be blind to the dispatcher: it would carry its own store,
leaving the queue that actually runs the work unread.

## The stale cross-cutting queue

`~/docs/plans/master-task-queue.md`, published at `docs.uptonm.io`, still advertises
Workstream C — *Mission Control — home.uptonm.io*, whose C1.3 reads "Read
`~/.hermes/kanban.db` directly from Next.js API routes (better-sqlite3)" and whose C2 is a
four-item "Kanban Board MVP".

It was written 2026-07-18, before the task-backlog kernel had its own UI spec. Every box
in it is still unchecked; its C2 duplicates a board that was already serving on port 9119
when it was written; and its central architectural instruction is the exact thing
`~/Projects/agents/docs/specs/003-TASK-UI.md` forbids — reading the kernel's database
directly rather than over the gateway. As it stands it reads as open, approved work,
and it is neither.
