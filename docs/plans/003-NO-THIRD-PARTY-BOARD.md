---
spec: 003-WORK-TRACKING
---

# Adopt no third-party board

> **NEEDS APPROVAL** — not approved; do not execute.

Three self-hosted kanban options were evaluated against `~/.hermes/kanban.db`:
`veritas-kanban`, Kibo UI, and `shadcn-kanban-board`. **None is adopted.** The investigation
that produced that answer also found one stale document that has to stop advertising work
nobody will do, and this plan is that correction plus the record of why.

## Why nothing is adopted

The premise the evaluation started from was wrong in both halves.

The database is not dead. `docs/specs/003-WORK-TRACKING.md` records the evidence — an
enabled gateway unit holding the dispatcher lock, `dispatch_in_gateway: true` on a
60-second tick, WAL files rewritten continuously, and a schema migration on 2026-08-12. The
board holds 47 tasks that are all terminal, which makes it *drained*, not abandoned. Nothing
here is safe to archive, and nothing needs replacing.

And a board is not missing. Hermes already ships four surfaces onto this exact kernel: a
bundled dashboard plugin serving `/kanban`, a ~40-route REST API with a WebSocket event
stream, a desktop TSX port, and ~50 `hermes kanban` CLI subcommands. Caddy already exposes
it at `https://dashboard.hermes.uptonm.io/kanban`. A second-generation surface is
specified in `~/Projects/agents/docs/specs/003-TASK-UI.md` behind plans `006-TASK-SEAM`
and `007-TASK-SURFACES`.

So the honest comparison is not "a board versus no board". It is "a board wired to the
kernel versus a second board that is not", and every candidate loses that comparison before
its own merits are reached.

## What changes

One file, outside this repo. `~/docs/plans/master-task-queue.md` is a plain unversioned
Markdown file served at `docs.uptonm.io` by `docs-site.service`. Its Workstream C —
*Mission Control — home.uptonm.io* — is marked superseded.

Nothing in `~/Projects/home` changes except the two documents that carry this record.

### Steps

1. Back up the target, per the house convention for unversioned config:

   ```bash
   cp ~/docs/plans/master-task-queue.md \
     "$HOME/docs/plans/master-task-queue.md.pre-board-decision.$(date +%Y%m%d_%H%M%S).bak"
   ```

2. In `~/docs/plans/master-task-queue.md`, insert a superseded note directly under the
   `## Workstream C: Mission Control — home.uptonm.io` heading, naming both the board that
   already ships (`https://dashboard.hermes.uptonm.io/kanban`) and the spec that owns the
   next one (`~/Projects/agents/docs/specs/003-TASK-UI.md`). Leave C1–C5 and their
   unchecked boxes in place as the record of what was once intended.

3. Update the lane's row in the `## Summary` table so the Mission Control count no longer
   reads as pending agent work.

4. Land `docs/specs/003-WORK-TRACKING.md` and this plan in `uptonm/home` on a branch, as a
   pull request. `docs/` is currently untracked there; this is its first content.

5. On approval, delete the `NEEDS APPROVAL` blockquote from this plan and remove the
   marked passage's marker in `docs/specs/003-WORK-TRACKING.md` — the section becomes plain
   present-tense text.

### Verification

- `curl -s https://docs.uptonm.io/plans/master-task-queue | grep -i superseded` returns the
  new note; the page renders without a build error from `docs-site.service`.
- `grep -rniE "kanban|veritas|kibo|dnd-kit" ~/Projects/home/apps ~/Projects/home/packages`
  still returns nothing — no dependency was added anywhere.
- `systemctl --user is-active hermes-gateway.service hermes-dashboard.service` both report
  `active`; `https://dashboard.hermes.uptonm.io/kanban` still loads. Nothing in this plan
  touches the running board, and this check proves it.
- `~/.hermes/kanban.db` is unmodified: its `Modify` timestamp is unchanged from before the
  work, and no `sqlite3` process ever opened it.
- `bun run ci` in `~/Projects/home` passes unchanged — documentation-only.

### Rollback

Restore the `.bak` written in step 1 over `~/docs/plans/master-task-queue.md`; the
docs site picks the file up without a restart. For the repository half, close the pull
request or revert the commit — the two documents are additive and nothing imports them.

There is no operational rollback to prepare, because no service, port, systemd unit, Caddy
site block, or database is touched.

## Considered and rejected

### veritas-kanban — a second, disconnected system

`BradGroux/veritas-kanban`, MIT, 815 stars, 101 forks. Genuinely the healthiest of the three
by activity: 1,240 commits since 2026-01-26, **525 in the last 90 days**, releases through
`v6.1.0` on 2026-07-26. One caveat on freshness — `pushed_at` reads 2026-08-10 but zero
commits landed on `main` after 2026-07-26, so the real idle time is ~22 days and the last
three weekly buckets are zero. Development is bursty and effectively solo (606 of the
commits are one author).

Its AI-agent integration is real, not a tagline: a first-class `@veritas-kanban/mcp`
workspace package built on `@modelcontextprotocol/sdk`, exposing 41–42 tools across nine
categories over stdio, plus a versioned REST API (`/api/v1/*`, `X-API-Version: v1`), a
WebSocket, an ETag-aware `/api/changes?since=` polling endpoint, and a `vk` CLI. Auth is
API keys with `agent` / `read-only` / `admin` roles. Storage is Markdown files by default
with SQLite as an opt-in backend.

**Rejected because the storage model is the whole problem.** Its board is its own — Markdown
files, or its own SQLite schema at `.veritas-kanban/veritas.db`. It cannot be pointed at
`~/.hermes/kanban.db`, and nothing in it understands `claim_lock`, `claim_expires`,
`consecutive_failures`, or `task_links` edge kinds. Adopting it means running a second task
system beside a live dispatcher that has never heard of it — two boards, two sets of truth,
and an agent queue whose supervisor is invisible to the UI that claims to show it.

Its headline feature is also the one already covered: Hermes exposes twelve in-process
`kanban_*` agent tools plus ~40 HTTP routes onto the real kernel. Trading those for 42 MCP
tools onto a different database is a downgrade dressed as an integration.

The operational cost seals it. This is a full application — another Node service, another
systemd unit, another loopback port, another Caddy site block, another API-key secret to
rotate, and a 74 MB repository to track — to duplicate a board already reachable at
`dashboard.hermes.uptonm.io/kanban`.

### Kibo UI — dormant, wrong primitive library, and misidentified

`haydenbleasel/kibo` **no longer exists under that name**. Both it and `haydenbleasel/roadmap-ui`
are GitHub redirects to `shadcnblocks/kibo`; all three paths resolve to repository id
`847167817`. The repo was renamed and transferred to an org. The `awesome-shadcn-ui` claim
was checked and is **confirmed**: that list carries `kibo-ui` and `roadmap-ui` as two
separate entries added three months apart, both pointing at this one repository.

MIT, 3,903 stars. It ships 41 components including `kanban`, `gantt`, `list`, `table` and
`calendar`. It does **not** ship AI primitives — there is no `ai` package and no `ai.mdx`;
any list entry implying otherwise is wrong.

**Rejected on three counts, any one of which is sufficient.**

*It is dormant.* Zero commits in the last 90 days. Last commit 2026-05-04, 105 days ago,
preceded by a two-month gap. Latest release `v1.1.5` is 292 days old. Its `updated_at` of
today reflects star churn, not code.

*It is Radix, and the house is Base UI.* `packages/shadcn-ui` depends on the unified
`radix-ui` package — pinned to the floating `"latest"` — plus the deprecated
`@radix-ui/react-icons`. A repo-wide search for `base-ui-components` returns zero hits.
`apps/site` and `~/Projects/agents/apps/web` both run `@base-ui/react` with no Radix
anywhere. Dropping in `packages/kanban` would import a second primitive library alongside
Base UI, with two focus-management and portal implementations in one tree, and would drag
in `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` and `tunnel-rat`. Its `gantt`
is heavier still — `jotai`, `date-fns`, `lodash.throttle`, `@uidotdev/usehooks`. So the
stated compatibility risk is confirmed, and it is not a version-skew problem that waiting
would fix; the libraries are alternatives to each other.

*There is nowhere to put it.* The only React surface this repo owns is `apps/site`, a
Vercel-deployed marketing and docs site with no route to a SQLite file on the homelab host.
Rendering this board would require the homelab-to-Vercel tunnel that has been designed and
never built — a security-relevant piece of infrastructure to build so a dormant component
can display a drained queue.

### shadcn-kanban-board — abandoned

`janhesters/shadcn-kanban-board`, MIT, 255 stars, `is_template: true`. Its entire history is
**seven commits spanning two days**, 2025-05-27 to 2025-05-29. Last commit
`ea1261c` (`fix(hero): fix svg decorations`) on 2025-05-29 — **445 days ago**. No releases,
no tags, one contributor. The brief estimated ~15 months stale; it is closer to fifteen and
a half, and the repo was never maintained at all rather than maintained and then dropped.

Its zero-dependency claim is **true**, and it is the only genuinely interesting thing here.
The shipped artifact is one file, `registry/new-york/ui/kanban.tsx`, importing nothing but
React, `react-dom`'s `createPortal`, four stock shadcn primitives (`button`, `skeleton`,
`textarea`, `tooltip`) and a local `cn`. Drag-and-drop is hand-rolled on native HTML5 DnD.
`registry.json` declares no npm dependencies. The ~30 runtime dependencies in the root
`package.json` belong to the marketing site, not the component. It does ship eleven
`--kanban-board-circle-*` oklch CSS variables, so "zero dependency" is not "zero config".

**Rejected because a component is not the missing piece.** Vendoring one unmaintained file
is a defensible move when a board is needed and no board exists. Here the board exists, the
next one is specified, and neither is short of a card-column primitive — `003-TASK-UI`'s
hard parts are the effective-priority ordering, the eight-word status vocabulary computed
server-side, and the cursor-resumable SSE stream. None of those is what this file provides.
It would also still need the Vercel-tunnel problem solved to see any data, and it depends
on `tooltip`, which `apps/site` has, and `skeleton` and `textarea`, which it does not.

### Archiving `kanban.db` — rejected on the evidence

This was the hypothesis the investigation was told was likely, and it is false. Archiving
the file would break a running dispatcher that holds a lock on its directory, is enabled at
boot, ticks every 60 seconds, and successfully executed a real plan on 2026-08-13. The
board is drained, which looks identical to dead in the data and means the opposite. The
correct action on a drained live queue is to put work in it, not to retire it.

### Doing nothing at all — rejected, narrowly

Adopting nothing is right. Changing nothing is not, by one document.
`~/docs/plans/master-task-queue.md` is published at `docs.uptonm.io` with an unchecked
four-item "Kanban Board MVP" under a Mission Control lane, and an instruction to read
`~/.hermes/kanban.db` directly from Next.js API routes via `better-sqlite3`. That lane
duplicates a board that was already serving on port 9119 when the document was written on
2026-07-18, and its central architectural instruction is the specific thing `003-TASK-UI`
forbids. Left alone it will send the next reader — human or agent — to build the thing this
plan exists to decline.

That is the entire change. Everything else here is a record.

## Open questions, deliberately not answered

**Linear's dormancy is not resolved by this plan.** Team `UPT` has not moved since
2026-05-30, and the `linear` CLI is not installed on this host, so deferred work goes into
pull request bodies instead of issues. Whether to revive Linear as the human tracker,
install its CLI, or retire the team is a separate decision with none of this plan's
evidence bearing on it. It is named here so it is not mistaken for something this plan
settled.
