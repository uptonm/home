---
spec: 000-CLI-OUTPUT-CONTRACT
---

# Keep Plain Output

> **NEEDS APPROVAL** — not approved; do not execute.

Decide the termcn question, and pin the output contract that answering it
depended on.

The evaluation concluded that `apps/home` should adopt **none** of termcn, Ink,
OpenTUI, or envin. That verdict is the substance of this plan; the code change
is small and follows from it.

## Why this plan exists at all

termcn is a real, MIT-licensed, actively pushed project, and "terminal UI
components for a CLI" sounds like an obvious fit. It is not one, and the reasons
are specific enough that they will be forgotten and re-argued in six months
unless they are written down. This document is that record.

The contract it would have broken is specified in
[`000-CLI-OUTPUT-CONTRACT`](../specs/000-CLI-OUTPUT-CONTRACT.md); this plan does
not restate it.

## The change

1. Add `apps/home/src/__tests__/output.test.ts`, testing `emit()` from
   `src/core/output.ts` directly. Four groups:
   - **Stream split** — a successful result writes its payload to stdout and
     nothing to stderr; a failed result writes `error: <message>` to stderr and
     nothing to stdout.
   - **JSON mode** — `{ json: true }` writes exactly one line, and
     `JSON.parse` round-trips it. On failure the object is
     `{ ok: false, code, message }` and it goes to **stdout**, not stderr.
   - **Exit codes** — `kind: 'user'` → 1, `kind: 'system'` → 2,
     `kind: 'config'` → 3, success → 0.
   - **No ANSI under a pipe** — the bytes `emit()` writes for an array payload
     contain no `\x1b`, and rows are not wrapped or truncated regardless of
     length.

   `emit()` calls `process.exit()` on every path, so the test injects fakes for
   `process.stdout.write`, `process.stderr.write`, and `process.exit` (throwing
   a sentinel to unwind), in the style already used by
   `src/__tests__/status-view.test.ts`.

2. Drop the `NEEDS APPROVAL` marker from the final section of the spec.

### Files touched

| File | Change |
| --- | --- |
| `apps/home/src/__tests__/output.test.ts` | new |
| `docs/specs/000-CLI-OUTPUT-CONTRACT.md` | remove one marker |

No source file changes. No dependency changes. No `ModuleManifest` changes, so
no `bun run build:install` and no `home skill install`.

### Verification

```bash
bun run home:typecheck   # currently clean
bun run home:test        # currently: 107 test files pass — expect 108
```

Both were run against the tree this plan was written from and both pass, so any
failure after the change is attributable to the change.

Never invoke `bun test` bare in this repo — `bun run home:test` delegates to
`scripts/test-isolated.sh`, which gives each file its own process because
`mock.module()` is process-global and has no teardown.

### Rollback

Delete `apps/home/src/__tests__/output.test.ts` and restore the marker. The
change adds one file and touches no shipped code, so there is nothing to
un-deploy and no binary to reinstall.

## Considered and rejected

### termcn on its Ink base

[github.com/shadcn-labs/termcn](https://github.com/shadcn-labs/termcn) — MIT,
1069 stars, created 2026-04-03, last pushed 2026-08-16.

**Latency.** This is the disqualifying fact and it was measured, not estimated.
A `bun build --compile` binary rendering a 20-row Ink view runs in **~139 ms**
(2.77 s / 20 runs) against the CLI's current **~44 ms**. That is **+95 ms, a
3.1× regression**, for a static list. Mount alone accounts for ~45 ms and
unmount ~7 ms; the cost is React reconciliation and Yoga layout, so it is paid
on every invocation and cannot be optimised away by bundling. From source
rather than a compiled binary, `import 'ink'` alone costs 50–70 ms — more than
the CLI's entire current runtime.

**It would break piped output.** Ink lays out through Yoga at a fixed terminal
width. With no controlling terminal — which is exactly the case when a Claude
skill or a script captures `home` output — `process.stdout.columns` is
undefined and Ink falls back to 80 columns
(`ink/build/utils.js`: `columns || fallbackSize.columns || 80`). Measured: a
200-character line came back as 80 / 80 / 40. The CLI currently emits lines up
to 247 characters unwrapped. Every wide table would be silently broken into
fragments in agent transcripts and log captures.

**It leaks ANSI where the CLI currently cannot.** Ink's non-TTY output is plain
only because chalk auto-disables. Under `FORCE_COLOR=1` a piped Ink render
emitted 80 escape bytes; the CLI under the same conditions emitted zero,
because it gates on `process.stdout.isTTY === true` and has no colour library
to override.

**The dependency is not small.** Ink 7.1.1 declares 25 runtime dependencies and
pulls in `react-reconciler`, `scheduler`, and `yoga-layout`. `react` + `ink`
alone is 23 MB and 38 packages in a CLI that currently has five direct
dependencies and no React at all. Ink also requires React ≥19.2 and declares
`engines.node >= 22`.

**It does not compile cleanly.** `bun build --compile` fails outright, because
`ink/build/devtools.js` statically imports the optional peer
`react-devtools-core`. Passing `--external react-devtools-core` makes the build
succeed and the **binary fail at runtime** — exit 1, zero output,
`Cannot find package 'react-devtools-core' from '/$bunfs/root/...'`. The
working fix is to install a React development tool as a production dependency
(node_modules 23 MB → 38 MB) purely to satisfy an import that is never
executed. Ink's tracker corroborates a long history here (#844, #603, #646),
and contains no issue about `bun build --compile` either way.

**The project is thinner than the star count suggests.** All **294 commits are
by a single author**. There are **zero releases and zero tags**. There are
**zero tests** — a PR adding vitest was closed unmerged — and CI runs lint,
typecheck, and a Next.js build on Node 22 with pnpm, so it **never renders or
executes a component**. Nothing is published to npm; the `termcn` package is a
45-byte empty placeholder. `shadcn-labs` is not the official `shadcn-ui` org.
An open PR (#11) stages a paid "Pro" tier gating registry delivery.

**The components would need auditing anyway.** Distribution is the shadcn
copy-in model, so the source becomes ours to maintain on arrival. Reading it:
`table.tsx` sorts via `String(a[key]).localeCompare(...)`, so numeric columns
sort lexicographically — 10 before 9 — which is a correctness bug for most of
what this CLI lists. `gauge.tsx` is 179 lines of which roughly 150 are three
near-duplicate box-drawing renderers. `tool-call.tsx` renders `args` and
`result` through `JSON.stringify` with no truncation.

Set against all of that, the benefit accrues to the one caller that is a human
typing at a prompt. Per the spec, every generated skill appends `--json`, so no
agent would ever see a termcn frame.

### termcn on its OpenTUI base

Worse on every axis that matters here, and less real than it appears.

**termcn does not actually build it.** `@opentui/*` appears nowhere in termcn's
lockfile. The OpenTUI half of the registry is typechecked against a
hand-written 715-byte `declare module "@opentui/react"` stub and previewed in a
browser via `ink-web`. It is never compiled or executed against real OpenTUI in
that repo or in its CI. One OpenTUI component also imports a hook from the Ink
namespace, so the two halves are not cleanly separable.

**Non-TTY behaviour is wrong for a pipe.** OpenTUI has no equivalent of Ink's
"write only the final frame" path. Sizing is `stdout.columns || config.width ||
80` with no `/dev/tty` probe, so a piped run gets a flat 80×24 and full ANSI
redraw frames go straight down the pipe, after burning a 5-second capability
detection timeout waiting for replies that never come.

**Weight and portability.** `@opentui/core` is 13.3 MB plus a ~21 MB native
`libopentui.so` per platform — about 34 MB installed for one target. It is
written in Zig and dispatches to one of eight prebuilt platform packages at
runtime, which sits badly with cross-compilation via `bun run home:build:linux`
and `home:build:mac`. Both `@opentui/core` and `@opentui/react` also ship raw
`.ts` as their entry points. Compiled-binary support is real and CI-tested, but
has broken three times in six months around native `dlopen` from bunfs and
tree-sitter worker assets, with further compile-only bugs still open.

### Ink directly, without termcn

Rejected for the latency, wrapping, ANSI, dependency, and compile findings
above, all of which are Ink's and not termcn's. Removing termcn removes the
governance and component-quality objections while leaving every technical one
intact.

### Ink for the e2e harness only — the narrow-surface option

This is the strongest case for adopting anything, and it still loses.

`e2e/tui.ts` is a live progress board and therefore the one genuinely
retained-mode view in the repo. It is a separate entrypoint, so it is not in
the shipped binary and Ink there would cost the `home` command nothing.

But it is **67 lines that work**, exercised by a developer-only command, on a
path already gated on `isTTY` with a non-TTY fallback. Replacing it would trade
67 owned lines for React plus 25 transitive dependencies, in service of no
behaviour change. That is the definition of the thing YAGNI exists to prevent.
Revisit only if the harness grows genuine interaction — scrolling, filtering,
or keyboard navigation.

### envin

[github.com/turbostarter/envin](https://github.com/turbostarter/envin) — MIT,
112 stars. The library itself is genuinely light: zero runtime dependencies, a
2.4 KB entry point, and it reads `process.env` at call time with no bundler
assumption. The objection is not quality.

It is a **category mismatch**. Per the spec, this CLI does not configure itself
from the environment: configuration is XDG JSON, secrets are in the OS keyring,
and validation is already declared per field on `ConfigField` and runs
interactively during `configure`. The dozen environment variables the CLI reads
are test seams and terminal conventions. Adopting envin would mean inventing an
environment-variable schema in order to have something for it to validate.

Its headline feature makes this concrete: "live preview" is `@envin/cli`, a
10.3 MB Next.js application launched as a dev server. There is no surface in a
compiled single-binary CLI for that to attach to.

Supporting signals: single maintainer, last release 2026-01-18, and **no
library-code commit in roughly seven months** — 2026 activity is dependabot and
docs-site work. Three non-PR issues have ever been filed, so the API has had
very little adversarial contact. `arktype` is missing from
`peerDependenciesMeta` and is therefore treated as a required peer even by
zod-only consumers.

### A small in-repo formatting module

The cheaper 80% option, and it is also declined — because the 80% is already
built and the remaining 20% is not wanted.

The candidate improvements were column alignment for `formatTable`, and merging
the two hand-rolled ANSI palettes (`src/core/status-view.ts` and the private
`ANSI` object in `src/core/configure.ts`). Alignment is actively harmful: per
the spec, TSV is chosen so piped output stays machine-readable, and padding
columns would destroy that. The duplicated palette is real but is two small
literal maps at opposite ends of the codebase with no shared behaviour to
extract; consolidating them creates an abstraction with one meaning and two
callers, which is the coupling SOLID warns about only once a third caller
exists.

What the investigation did surface as a real gap is the missing test, which is
why that is the only thing this plan changes.

## Open question

Nothing here forecloses a future interactive surface. If `home` ever grows a
genuinely interactive command — a picker, a live tail, a long-running watch —
that command is a new entrypoint with its own latency budget, and Ink becomes
worth re-evaluating **for that entrypoint alone**. The finding to carry forward
is that it must not sit on the path of the batch commands, and must never be
the renderer for anything a skill captures.
