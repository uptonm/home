---
spec: 001-AGENT-CONSOLE-SURFACES
---

# Decline the agent-UI component libraries; close the dead console

> **NEEDS APPROVAL** — not approved; do not execute.

**Execution targets `uptonm/agents`**, not `uptonm/home`. This plan lives here
because the evaluation was run here, but every code change it describes lands in
`~/Projects/agents`, plus one deletion on this host. **Nothing in this plan
modifies `uptonm/home`.**

**Goal:** record that no third-party agent-UI component library is adopted,
close the one real gap the evaluation found, and delete the decommissioned
`~/hermes-webui` clone so the next session does not re-discover it as live.

Constraints, surfaces and the four adoption gates are in
[`001-AGENT-CONSOLE-SURFACES`](../specs/001-AGENT-CONSOLE-SURFACES.md). This plan
does not restate them.

## Why decline

Five libraries were evaluated on 2026-08-17. All five are MIT, verified from the
LICENSE file:

| Library | Stars | Last commit on main | Distribution | Runtime coupling |
|---|---|---|---|---|
| `assistant-ui/assistant-ui` | 11,698 | 2026-08-17 (today) | npm core + shadcn registry for visuals | Composes — `useExternalStoreRuntime` |
| `assistant-ui/tool-ui` | 771 | 2026-03-24 (~5 mo) | shadcn registry, copy-in | None — props only |
| `21st-dev/agent-elements` | 91 | 2026-04-24 (~4 mo) | shadcn registry, copy-in | None — props only |
| `victorcodess/nexus-ui` | 132 | 2026-06-16 (~2 mo) | shadcn registry, copy-in | None — props only |
| `Alwurts/simple-ai` | 755 | 2026-01-03 (~7.5 mo) | shadcn registry, copy-in | None in `registry:ui` |

**The coupling fear was unfounded and it does not help.** The expected blocker
was that assistant-ui would demand to own the data flow. It does not.
`useExternalStoreRuntime` takes `T[]` plus a `convertMessage: (T, idx) =>
ThreadMessageLike`, and that conditional type *forces* the converter when `T` is
not already its own message type. `ThreadMessageLike` requires only `role` and
`content`, and `content` may be a bare string. `@assistant-ui/react` declares no
`ai` or `@ai-sdk/*` dependency; the AI SDK lives in a separate opt-in package. A
read-only transcript works — `onNew` is structurally required but a no-op
satisfies it, and since `thread.tsx` is copied into our repo, the composer is
ours to delete.

So all five compose. Every one of them could be fed `ThreadEntry`. The reason to
decline is not architectural coupling — it is that adoption costs more than it
returns, on four counts.

**1. Three of the four adoption gates fail for four of the five.** tool-ui,
nexus-ui, simple-ai and assistant-ui's visual layer all require shadcn/ui
primitives and the shadcn token vocabulary. `apps/web/__tests__/tokens.test.ts`
asserts that vocabulary absent. Adopting any of them means either deleting a
passing test that exists to protect a deliberate design decision, or maintaining
a permanent translation layer between two token systems. Both are worse than the
status quo. nexus-ui, simple-ai and tool-ui additionally need Radix, where
`apps/web` uses Base UI.

**2. The one differentiated feature does not transfer.** agent-elements is the
only candidate with real per-tool cards, and the only one whose primitive layer
already matches ours — Base UI, Tailwind v4, Next 16, React 19. But it dispatches
on hardcoded Anthropic tool names (`tool-Bash`, `tool-Edit`, `tool-Write`,
`tool-Grep`, `tool-TodoWrite`) and decodes Claude Code's exact result payloads:
`result.structuredPatch[].lines`, `result.stdout`/`stderr`/`exitCode`,
`args.file_path`, and `TodoWrite`'s `{ content, status, activeForm }`. Hermes
emits none of that. Every card takes `part: any`, so nothing surfaces the
mismatch at compile time. Adapting them means rewriting the body of each card
against a different schema — which is writing our own cards while inheriting
someone else's `any`-typed props and a repo whose only open issue is an
unanswered *"Is anyone there?"* from 2026-07-17.

**3. Two headline features have no data.** Context meters and diff views are what
these libraries lead with. Per the spec, the corpus supports neither.

**4. Staleness cuts the wrong way for the ones that fit best.** simple-ai has
open, actionable bugs from January 2025 still untouched. tool-ui is pinned
against `@assistant-ui/react ^0.12.3` while assistant-ui ships `0.15.14`.
nexus-ui is a bus factor of one, and its advertised voice components do not
exist in the registry. Copy-in means stale upstream cannot break us — but it also
means we own every bug we copy, which is the same as writing it, minus the
understanding.

## What the evaluation did find worth taking

One thing, and it is not a component library.

`apps/web/src/components/chat/live-turn.tsx` re-parses markdown on every delta,
and the code says what that costs: a partially-typed fence *"renders as prose
until its closing ``` arrives."* The alternative it rejected — plain text until
the turn ends — moves the whole reply at the moment it finishes reading.

`remend` solves exactly that. It is the self-healing-markdown core extracted from
`vercel/streamdown`, **Apache-2.0**, with **zero dependencies and zero peer
dependencies**. It is a pure string-to-string function: incomplete markdown in,
completable markdown out. It feeds the `react-markdown` + `remark-gfm` already
installed. It is not a component, brings no tokens, no Radix, no primitives, and
no styling opinion.

Honest caveat: it is Apache-2.0, not MIT, and adopting it is still a dependency.
Declining it too is defensible and costs one rendering wart.

## Steps

### 1. Record the decision — `uptonm/agents`

- [ ] Add a short section to `agents/docs/specs/001-CHAT.md` stating that the
      transcript and live turn are hand-built, that no third-party agent-UI
      component library is used, and citing this plan for why. One paragraph —
      the reasoning lives here, not there.
- [ ] Do not copy the comparison table into the agents repo. It is a
      point-in-time evaluation, not a fact about the system.

### 2. Adopt `remend` in the live turn — `uptonm/agents`

- [ ] `cd apps/web && bun add remend`
- [ ] In `src/components/chat/markdown.tsx`, accept an `incomplete?: boolean`
      prop; when set, pass `text` through `remend` before rendering.
- [ ] In `src/components/chat/live-turn.tsx`, pass `incomplete={busy}` to
      `<Markdown>`.
- [ ] Replace the comment at `live-turn.tsx:216` describing the fence wart. It
      documents behaviour that this step removes, and a comment that outlives its
      subject is worse than none.
- [ ] Add a test asserting that an unclosed ` ``` ` fence renders as a code block
      while `incomplete` is set, and that settled text is unchanged.

### 3. Delete the dead clone — this host only

- [ ] Confirm once more that nothing serves it: no `hermes.uptonm.io` in
      `/etc/caddy/Caddyfile`, nothing listening on 8787, no systemd unit.
- [ ] `rm -rf ~/hermes-webui`
- [ ] No Caddy change is needed. The route was removed on 2026-08-06.

Nothing of ours is lost — it is an unmodified clone of a public MIT repository
and can be re-cloned in one command. Its only local state is a `.env` pointing at
a port nothing listens on and a stale merge index.

## Verification

- [ ] `cd apps/web && bun run test` — 812+ tests green, including
      `__tests__/tokens.test.ts`, which must still assert the shadcn vocabulary
      absent.
- [ ] `cd apps/web && bun run typecheck`
- [ ] `bun run lint` at the agents repo root.
- [ ] `bun run proof:capture` and `proof:check` if the live turn's appearance
      changed — step 2 changes what a mid-stream fence looks like, which is a
      visual change.
- [ ] Live check: start a turn on `agents.uptonm.io` whose reply opens a fenced
      code block, and confirm it renders as a code block before the closing
      fence arrives. Per the agents repo rules this is a real turn on a real
      session — use a scratch prompt.
- [ ] `ls ~/hermes-webui` returns nothing.

## Rollback

Step 1 is a doc edit; revert the commit.

Step 2 is one dependency and two components. `bun remove remend` and revert. The
`incomplete` prop is additive and defaults off, so a partial revert degrades to
current behaviour rather than breaking.

Step 3 is `git clone https://github.com/nesquena/hermes-webui.git ~/hermes-webui`.
The stale merge index is not worth reconstructing and was never wanted.

## Considered and rejected

**(a) Fork `nesquena/hermes-webui` to `uptonm/` and rewrite the frontend in
React.** Rejected. The house rule *"fork it, don't work around it"* applies when
a forked dependency forces a workaround — we have not forked this, and the rule
does not argue for acquiring a fork we would then have to carry. Upstream is
17.4k stars, 2,397 forks, 181 MB, and roughly seven commits a day; at least 100
landed in the fourteen days after our clone last fetched. The frontend is ~90k
lines of vanilla JS in files up to 20,668 lines long, loaded as plain `<script>`
tags. Rewriting that into React while tracking that rate of upstream change is
not a project with an end. **Estimate: many months, and it never finishes** — the
first merge after the rewrite conflicts with everything. This is the option that
strands us on an upstream we do not control, and it is the reason to say so
explicitly.

**(b) Build a new React console as `apps/hermes-console` in `uptonm/home`.**
Rejected — it already exists, in the right repo. `agents/apps/web` is Next 16 /
React 19 / Tailwind v4 / Base UI / Bun / Biome, deployed at `agents.uptonm.io`,
with 812 tests, 24 integration tests, three design gates, and specs covering the
gateway contract and the chat surface. Building a second one in `home` would
split the console across two repos, duplicate the gateway client and the fence
that keeps `HERMES_API_KEY` server-side, and leave the tested one running. `home`
is a CLI with generated skills; a Next app does not belong in it.

**(c) Adopt nothing and change nothing.** Not rejected — this is the
recommendation, minus step 2. If step 2 is not approved, the rest still stands.
Steps 1 and 3 cost nothing and prevent the next session from re-running this
evaluation or mistaking `~/hermes-webui` for live.

**(d) Adopt `agent-elements`' cards and adapt them to Hermes tool names.**
Rejected. It is the closest fit on stack — the only candidate on Base UI. But per
*Why decline* §2, adapting means rewriting each card's body against a different
schema, inheriting `part: any` and a four-month-stale upstream. If per-tool cards
are wanted, writing them against `ThreadEntry` — typed, tested, ours — is
**roughly two to three evenings for the five tools that carry the traffic**
(`execute_code`, `patch`, `read_file`, `terminal`, `delegate_task`), and cheaper
than the adaptation. That is a separate plan, and it should be preceded by
evidence that the current one-line-per-tool rendering is actually insufficient.
Nobody has said it is.

**(e) Adopt `assistant-ui` headless (`@assistant-ui/react` primitives only,
skip the registry).** Rejected, and this is the closest call. It sidesteps the
token gate entirely, since the headless half has no styling opinion, and
`useExternalStoreRuntime` + `convertMessage` would take `ThreadEntry`
essentially as-is. What it buys is the message-tree model: branching, editing,
regeneration, optimistic messages. What it costs is Radix and Zustand as
transitive dependencies, and adopting a message-tree abstraction for a surface
that has no branching, no editing and no regeneration — the gateway exposes
`POST /v1/runs` and `POST /v1/runs/{id}/stop`, and nothing else. That is YAGNI:
an abstraction with one shape of data and no second consumer in sight.

**(f) Adopt `streamdown` rather than `remend` for the fence gap.** Rejected.
`streamdown` is the full renderer and pulls `mermaid`, `unified`, `rehype-raw`,
`rehype-sanitize`, `rehype-harden` and a dozen more. `apps/web` already renders
markdown with `react-markdown` + `remark-gfm`. `remend` is the ~50-line kernel of
the same project with zero dependencies, and it is the only part of it we lack.

**(g) Adopt `@pierre/diffs` for diff rendering.** Rejected — no data. Per the
spec, a tool result is an opaque string and Hermes' `patch` tool emits nothing
comparable to `structuredPatch`. A diff component would be parsing prose. Revisit
only if the gateway starts emitting structured patch data.

## Effort

| Step | Estimate |
|---|---|
| 1. Record the decision | under one evening |
| 2. `remend` in the live turn | one evening, including the test and proof capture |
| 3. Delete the dead clone | minutes |
| **Total** | **one to two evenings** |

For contrast, the rejected options: (a) many months and no end state; (b) weeks,
to arrive at something worse than what runs today; (d) two to three evenings, but
only after someone demonstrates the need.

## Open question for the approver

Step 2 is the only part that adds a dependency, and it is Apache-2.0 rather than
MIT. Approving steps 1 and 3 while declining 2 is a coherent outcome and leaves
the console exactly as it is.
