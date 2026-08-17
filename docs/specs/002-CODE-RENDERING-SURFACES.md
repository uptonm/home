---
plans: [002-DECLINE-PIERRE-DIFFS]
---

# Code and Diff Rendering Surfaces

This repo renders code in exactly one place and renders diffs in none.

"Rendering" here means turning source text or a patch into something a human
reads — syntax colors, split/unified hunks, gutters, a file hierarchy. Passing
another tool's already-formatted bytes through to stdout is not rendering, and
the distinction is what most of this document turns on.

The whole inventory is three workspaces: `apps/home` (the CLI), `apps/site`
(marketing plus docs), and `packages/brand` (static image assets, no code). Only
`apps/site` ships to a browser.

## `apps/site` — the only real code renderer

The site is a marketing landing page plus a Fumadocs documentation site served
at `home.uptonm.dev`. `src/app/` holds `page.tsx` (landing), `docs/[[...slug]]`
(docs), `api/search/route.ts`, and the metadata routes. There is no dashboard
and no authenticated application area — Clerk appears only as a production
environment gate in `apps/site/proxy.ts`.

The site makes no network calls. There is no `fetch(` anywhere in `src/`, no
Octokit, and no GitHub token. GitHub appears only as static hrefs built from
`siteConfig.githubUrl`, plus the "Edit on GitHub" link and the `/install.sh`
redirect in `next.config.ts`.

### Syntax highlighting is Shiki, at build time, in RSC

`apps/site/source.config.ts` is `defineConfig({ mdxOptions: {} })`, so
fumadocs-mdx's defaults apply. Those defaults wire in `rehypeCode`, which
highlights MDX code fences with **Shiki** during the build using the
`github-light` and `github-dark` themes with `defaultColor: false`.

Shiki is therefore already in the dependency tree — `shiki@4.3.1` plus its
`@shikijs/*` companions — arriving transitively as a dependency of both
`fumadocs-core` and `fumadocs-ui`. It is not listed in `apps/site/package.json`
and is not imported by any file the repo owns.

Highlighting happens entirely at build time on the server. No Shiki grammar,
theme, or engine reaches the browser, and no component in `src/` calls a
highlighter.

`<pre>` is mapped to fumadocs' `CodeBlock` / `Pre` through `defaultMdxComponents`
in `apps/site/src/mdx-components.tsx`.

Two hand-rolled, unhighlighted code surfaces also exist and are deliberate:
`src/components/site/operations.tsx` renders a fake terminal as literal
`<pre><code>` with manually colored `<span>`s, and
`src/components/site/copy-command.tsx` renders a single copyable `<code>` line.

### Diff rendering is available but unused

Fumadocs' default `rehypeCode` options include Shiki's `transformerNotationDiff`,
and the matching CSS — `.diff.add` / `.diff.remove`, their `--color-fd-diff-*`
variables, and the `+` / `-` `::before` markers — is already loaded through the
`fumadocs-ui` preset imported at `src/app/globals.css`.

So the site can already render added and removed lines inside any MDX code fence
using `// [!code ++]` / `// [!code --]` notation, at zero additional cost. No
page under `content/docs/` uses that notation today.

Beyond that, the site has no diff feature: nothing parses a patch, nothing
renders hunks, and nothing displays a split or unified view.

### There is no file tree

No component renders a filesystem hierarchy. The only `tree` in the app is
`<DocsLayout tree={source.pageTree}>` in `src/app/docs/layout.tsx`, which is the
docs *navigation* sidebar built from `content/docs/meta.json` — a page index,
not a file tree.

Directory structures in the docs are plain text inside ```text fences, drawn
with `└──` characters, in `content/docs/configuration.mdx` and
`content/docs/development.mdx`.

`fumadocs-ui` ships `Files` / `File` / `Folder` components. They are already
installed, already paid for, and not registered in `src/mdx-components.tsx`.

## `apps/home` — the CLI renders nothing

The CLI has no `.tsx`, `.jsx`, `.html`, or `.css` files, no React, and no
syntax highlighter. Its dependencies are `@napi-rs/keyring`, `@svrooij/sonos`,
`citty`, `consola`, and `socket.io-client`.

The entire presentation layer is `src/core/output.ts` — roughly seventy lines.
`emit(result, { json })` writes single-line JSON under `--json`; otherwise
`formatHuman()` passes strings through verbatim, renders arrays as a
tab-separated table, and falls back to `JSON.stringify(data, null, 2)` for
anything else. The one purpose-built human renderer in the codebase is
`renderStatus()` in `src/core/status-view.ts`, which draws the `home status`
board.

ANSI color appears in exactly three places — the status board, the interactive
`configure` prompts (on stderr), and the e2e test runner. None of them touch
code or diffs. The graphite module runs the other way and strips color through
`stripAnsi()`.

### `home github prs diff` is a passthrough

One command touches diffs: `home github prs diff`, defined in
`src/modules/github/commands/prs.ts` and implemented by `getPrDiff()` in
`src/modules/github/client.ts`. It shells `gh pr diff <selector> [--name-only]`,
caps output at `DIFF_MAX_BYTES` (256 KiB), and returns
`{ patch, truncated }` — or `{ files, truncated }` for `--name-only`. The patch
is unparsed: no per-file grouping, no hunk structure, no `+`/`-` treatment.

Because the payload is an object rather than a string or array, the human output
path falls through to pretty-JSON, so `home github prs diff` without `--json`
prints the patch as a JSON-escaped string with literal `\n` sequences. That is
the one genuine diff-rendering defect in this repo. It is a defect in
`output.ts`, not a missing library.

Aggregate change data — `additions`, `deletions`, `changedFiles` — is surfaced
as three integers on `home github prs get`. No `.diff` or `.patch` file is ever
written or fetched.

`home vercel config diff` shares the word and nothing else: it compares config
and secret *keys* between the host and Vercel and never emits values.

### The graphite module relays a drawing it refuses to read

`home graphite stack list` runs `gt log short --no-interactive` and returns
`{ raw, rawTruncated, branches, topology }`. `raw` contains gt's own ASCII graph
(`◯ ◉ │ ─ ┴ ┘`), ANSI-stripped and capped at 20,000 characters. The module
never composes that picture and deliberately never interprets it — the glyphs
are documented as decorative in `src/modules/graphite/client.ts`. Real topology
comes from separate `gt info` calls and lands as a flat `branches[]` array with
a `parent` string field. Nothing walks it into nested output.

So the CLI relays two rendered artifacts — `gh`'s patch and `gt`'s graph — and
renders neither.

## Skill workflows — GitHub.com is the renderer

`pr-stack-review` reads diff text (`git diff`, `git show`) only to compute line
numbers, and posts inline comments via
`gh api -X POST repos/OWNER/REPO/pulls/N/reviews`. `pr-triage` consumes
`gh pr view` and `gh api .../comments` and emits a markdown table into the
conversation plus reply comments and Linear tickets. `gh-stack` is terminal-only
and explicitly bans its own interactive TUI.

None of these render a diff for a human to look at. A human reads the result on
GitHub.com, which does the rendering.

`visual-proof` is a Playwright camera pointed at a running application. It reads
the diff only as source material for falsifiable claims about visible behavior,
and its artifacts are `.webp` / `.mp4` files embedded in a PR body. It renders
no code.

No skill in `~/.claude/skills/` installs a syntax highlighter. Greping the whole
directory for `shiki`, `prism`, `highlight.js`, `hljs`, `diff2html`, `monaco`,
and `codemirror` returns nothing.

## `hermes-webui` renders both, and is not ours

`~/hermes-webui` is a read-only clone of upstream `nesquena/hermes-webui`, and
`hermes.uptonm.io` is served from that upstream project. It is not a surface
this repo can add a dependency to — a change there is an upstream contribution,
not a change to `home`. There is no Hermes agent console in this repo, planned
or otherwise.

It is the one place nearby that genuinely renders diffs and a file tree today,
so what it does bounds what any future console here would need to beat.

It renders diffs three times over, as hand-rolled line colorizers that wrap each
line in `<span class="diff-line diff-plus|diff-minus|diff-hunk">`: fenced
` ```diff ` blocks in assistant markdown, tool-card snippets via
`_colorDiffLines()`, and inline `.patch` attachments via `loadDiffInline()`.
There is no split view, no line numbers, no intra-line word highlighting, and no
context expansion. Edit-like tool calls get a synthesized pseudo-diff —
`_cliPatchSnippetFromArgs()` prefixes the whole old string with `-` and the whole
new string with `+`, producing something with no `@@` headers and no context
lines. The checkpoint viewer at `_viewCheckpointDiff()` renders a plain escaped
`<pre>` with no coloring at all, and the backend's `/api/git/diff` endpoint has
no frontend consumer.

Its file tree is `renderFileTree()` / `_renderTreeItems()`, building
`div.file-item` rows directly with `paddingLeft = 8 + depth * 16` and `▾`/`▸`
glyph toggles, with expand/collapse, drag-and-drop move, context menu, rename,
and delete.

None of that can consume an npm package. The app is Python `http.server` plus
fourteen classic `<script defer>` files sharing one global scope, with no
bundler and no framework — a constraint stated in its `CONTRIBUTING.md`,
`AGENTS.md`, `ARCHITECTURE.md`, and `README.md`. Third-party code arrives only
as CDN script tags (Prism 1.29, xterm 5.3) or prebuilt single files vendored
into `static/vendor/` (KaTeX, js-yaml, streaming-markdown).

The single exception is the dashboard-plugin slot: `api/routes.py` serves a
plugin's `dashboard/dist/index.html` as a full SPA build, discovered from
`~/.hermes/plugins`, sandboxed in an iframe on a null origin. A bundled React
diff viewer is supported there — in a separate plugin repo, unable to reach the
transcript DOM.

## Third-party diff and tree renderers

Neither `@pierre/diffs` nor `@pierre/trees` is a dependency of this repo, and
nothing in it imports either package.

> **NEEDS APPROVAL** — [`002-DECLINE-PIERRE-DIFFS`](../plans/002-DECLINE-PIERRE-DIFFS.md)
>
> `apps/site` depends on `@pierre/diffs` and `@pierre/trees`, and renders pull
> request diffs and repository file trees as React components.
>
> Plan 002 evaluated this and recommends rejecting it. Approving that
> recommendation means deleting this passage and leaving the plan in place as
> the record.
