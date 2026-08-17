---
spec: 002-CODE-RENDERING-SURFACES
---

# Decline `@pierre/diffs` and `@pierre/trees`

> **NEEDS APPROVAL** — not approved; do not execute.

**Recommendation: reject.** The packages are real, well-made, and genuinely
consumable standalone. We have nowhere to put them. Spec 002 records the
surfaces; not one of them renders a diff or a file tree, and the only surface
that could is a marketing-and-docs site where the feature would be invented to
justify the dependency.

Approving this recommendation is one edit: delete the `NEEDS APPROVAL` passage
at the end of spec 002. This file stays, unexecuted, as the record of what was
evaluated and turned down.

## What was evaluated

`@pierre/diffs` and `@pierre/trees`, published from `pierrecomputer/pierre`
(Apache-2.0, 6,009 stars, last push 2026-08-15, not archived).

Everything below was verified against the npm registry and the published
tarballs on 2026-08-17, not against the marketing sites.

### They are genuinely published and independently consumable

| | `@pierre/diffs` | `@pierre/trees` |
|---|---|---|
| latest | `1.3.5`, 2026-08-07 | `1.0.0-beta.6`, 2026-07-25 |
| first publish | 2025-12-10 | 2026-03-16 |
| versions | 98 | 9 |
| `latest` tag is stable? | yes | **no — points at a beta** |
| unpacked | 6.93 MB, 809 files | 1.46 MB, 244 files |
| downloads/wk | 2,176,044 | 458,013 |
| module format | ESM only, no CJS condition | ESM only, no CJS condition |
| React peer | `^18.3.1 \|\| ^19.0.0` | `^18.3.1 \|\| ^19.0.0` |

Both ship a full Apache-2.0 `LICENSE.md` in the tarball and declare
`"license": "apache-2.0"` in the published `package.json`; the two license files
are byte-identical to each other and to the monorepo's root `LICENSE.md`.
`@pierre/trees` also ships a `NOTICE.md` crediting MIT-licensed
`@headless-tree/core` for ideas its `path-store` core replaced. The license
question is settled: Apache-2.0 applies to the published artifacts, not just the
repo.

Neither drags in the Pierre app. `@pierre/diffs` depends on `diff`, `shiki`,
`lru_map`, `hast-util-to-html`, `@shikijs/transformers`, and two first-party
packages — `@pierre/theme@2.0.0` and `@pierre/theming@1.0.1` — both of which are
published, Apache-2.0, and have zero dependencies of their own. `@pierre/trees`
depends on `preact`, `preact-render-to-string`, and `@pierre/theming`. Nothing
private, nothing unresolvable.

Both READMEs are complete standalone API documentation. Both expose real
subpath exports (`.`, `./react`, `./ssr`, plus `./edit` and `./worker` for
diffs, `./web-components` for trees). This is not a library that only works
inside its parent monorepo.

`React 19 is supported`, verified two ways: the peer range admits `^19.0.0`, and
both packages build against `react@19.2.7` / `@types/react@19.2.7` in their own
devDependencies. `apps/site` runs `react@19.2.4`.

### What adopting `@pierre/diffs` would cost

Client bundle, measured by tracing the published module graph and gzipping it —
**`@pierre/diffs`' own code only**, excluding React, Shiki, `diff`, and
`hast-util-to-html`:

| entry | modules | raw | gzip |
|---|---|---|---|
| `@pierre/diffs/react` | 150 | 777 KB | **155 KB** |
| `@pierre/diffs` (root) | 147 | 736 KB | 150 KB |
| `@pierre/diffs/ssr` | 116 | 492 KB | 99 KB |
| `react/FileDiff` alone | 124 | 545 KB | **109 KB** |

That last row is the important one. Importing a single component pulls 124 of
the package's modules. The root entry is a barrel that re-exports essentially
everything, and the component graph is densely interconnected, so there is no
cheap subset — 109 KB gzipped is the floor for any client-side use, before
Shiki's runtime, engine, theme, and grammar chunks land on top.

`shiki` is already in the tree at `4.3.1`, transitively via `fumadocs-core` and
`fumadocs-ui` (spec 002), so Shiki's ~11 MB of grammars and themes on disk is
already paid for. Net new install weight is roughly 8.6 MB: `@pierre/diffs`
6.93 + `@pierre/theme` 0.82 + `@pierre/theming` 0.18 + `diff` 0.62.

The Shiki *bundle* question resolves better than expected.
`highlighter/languages/resolveLanguage.js` statically imports `bundledLanguages`
from `shiki`, which is a map of ~200 lazy `() => import()` thunks. A bundler
emits a chunk per grammar, so the cost is build time and `.next/` output size,
not first-load JavaScript — only the grammars actually used are fetched.

**Server-only rendering is possible.** `@pierre/diffs/ssr` exports `renderHTML`
and a family of `preload*` functions that return a `prerenderedHTML` string. I
traced its module graph: 116 modules, zero `"use client"` directives, zero
references to React. The custom-element registration in
`components/web-components.js` is guarded by `typeof HTMLElement !== "undefined"`,
so it no-ops under Node. The intended Next pattern is an RSC calling `preload*`
and handing the HTML to a `"use client"` component to hydrate — the ten
`"use client"` files all live under `dist/react/`.

But that is the shape of the trap. If we only need static rendered diffs, the
`/ssr` entry gives us an HTML string — and so does Shiki, which is already
installed. The 109 KB is the price of the interactivity: line selection, token
hover, annotations, merge-conflict resolution UI, beta editing. No surface in
spec 002 wants any of that.

One integration fact that matters for a shadcn/Tailwind site: both packages
render inside a shadow root with `adoptedStyleSheets`. Host CSS does not cascade
in. Styling goes through documented CSS variables, `themeToTreeStyles()`, or an
`unsafeCSS` escape hatch. That buys total style isolation and costs the ability
to restyle with the utility classes the rest of `apps/site` uses.

### What adopting `@pierre/trees` would cost

It has no consumer at all. Spec 002 finds no file-tree surface anywhere in this
repo, and `fumadocs-ui` already ships unused `Files` / `File` / `Folder`
components that would cover a docs file tree at zero cost if one were ever
wanted.

It also carries two risks `@pierre/diffs` does not. Its `latest` dist-tag points
at `1.0.0-beta.6` — still prerelease after nine versions. And it pins
`preact@11.0.0-beta.0` exactly, as a runtime dependency: adopting it ships both
React 19 and a prerelease Preact 11 to the browser. Preact 11 is not stable
(`latest` is `10.29.8`), and the pinned `beta.0` is from 2025-08-19 while
`beta.2` and `rc.0` have since shipped. That pin is a year stale.

## The change, if approved

1. `bun add --cwd apps/site @pierre/diffs @pierre/trees`
2. Add a diff-rendering route or component under `apps/site/src/`. **This step
   has no defined content**, because no requirement exists for it — the feature
   would have to be specified before it could be built. That absence is the
   whole argument.
3. Register any new MDX component in `apps/site/src/mdx-components.tsx`.
4. Map the site's theme tokens onto the packages' CSS variables, since host
   Tailwind classes do not reach inside their shadow roots.

Files touched: `apps/site/package.json`, `bun.lock`, new files under
`apps/site/src/`, and `apps/site/src/mdx-components.tsx`.

### Verification

Baseline confirmed green on 2026-08-17 before this plan was written:

```bash
bun run site:lint        # Checked 44 files in 5ms. No fixes applied.  exit 0
bun run site:typecheck   # fumadocs-mdx + tsc --noEmit                 exit 0
```

If executed, all three must pass, and the third is the one that matters:

```bash
bun run site:typecheck   # ESM-only types resolve under moduleResolution: "bundler"
bun run site:lint
bun run site:build       # Turbopack must survive ~200 lazy Shiki grammar chunks
```

`apps/site/AGENTS.md` requires reading `node_modules/next/dist/docs/` before
writing Next 16 code; middleware lives in `proxy.ts`, not `middleware.ts`.

### Rollback

`bun remove --cwd apps/site @pierre/diffs @pierre/trees`, delete the new files,
revert `mdx-components.tsx` and `bun.lock`. Nothing else in the repo would
reference either package, so rollback is complete by construction — which is
another way of saying nothing depends on them.

## Considered and rejected

**Adopt `@pierre/diffs` in `apps/site`.** Rejected: there is no diff feature on
the site and no requirement for one. The site is a marketing landing page and a
Fumadocs docs site that makes no network calls at all — no `fetch(`, no Octokit,
no GitHub token — so there is no PR, commit, or patch data reaching it to
render. Adopting here means inventing the feature to justify the library.

**Adopt `@pierre/diffs` for the `pr-stack-review` / `pr-triage` workflows.**
Rejected: category error. Those skills run in a terminal and emit inline GitHub
review comments via `gh api`. They read diff text only to compute the line
numbers a comment attaches to. The human reads the result on GitHub.com, which
already renders the diff. A React component has nowhere to mount.

**Adopt `@pierre/diffs` in the `home` CLI.** Rejected: the CLI writes to a
terminal. `/ssr` produces HTML, which is exactly the wrong artifact. The CLI has
no `.tsx`, no React, no HTML output beyond two static OAuth callback pages.

**Adopt `@pierre/diffs` in `hermes-webui`.** Rejected on two independent
grounds. It is upstream and read-only — not ours to change. And it could not
consume the package if it were: it has no bundler by documented policy, and
both packages ship unbundled multi-file ESM with no `.min.js`, UMD, or IIFE
build, so the "vendor a prebuilt file into `static/vendor/`" path it uses for
KaTeX and js-yaml does not exist here. The dashboard-plugin slot could host a
bundled React viewer, but that is a separate repo, iframe-sandboxed on a null
origin, and cannot reach the transcript DOM — a new product, not a dependency
upgrade.

**Adopt `@pierre/trees` anywhere.** Rejected: no file-tree surface exists in any
repo we own. `fumadocs-ui` already ships `Files` / `File` / `Folder`, installed
and unregistered, which would serve a docs file tree at zero marginal cost.
Adopting a still-beta package that pins a year-old Preact 11 prerelease, for a
surface that does not exist, fails YAGNI twice over.

**Build it ourselves with `shiki` + a diff parser.** Rejected too, for the same
reason — but noted, because it is the correct answer the day a requirement
appears. For static rendered diffs, `shiki` (already installed) plus the `diff`
package really is on the order of 200 lines, all server-side, zero client JS.
Fumadocs goes further: its default `rehypeCode` already enables
`transformerNotationDiff`, and `fumadocs-ui`'s `.diff.add` / `.diff.remove` CSS
is already loaded through the preset. Added and removed lines can be rendered in
any MDX code fence today, using `// [!code ++]` notation, for free. If a
lightweight need shows up, that path costs nothing and should be tried first.
`@pierre/diffs` earns its 109 KB only when line selection, hover callbacks,
annotations, or merge-conflict resolution are actually required.

**Fix `home github prs diff` human output.** Deferred to its own plan, not
rejected. Spec 002 records the one genuine diff-rendering defect in this repo:
the command returns an object, so `formatHuman()` falls through to pretty-JSON
and prints the patch as a JSON-escaped string with literal `\n`. The fix is a
few lines in `apps/home/src/core/output.ts` or the command's return shape, and
it needs no dependency. It is out of scope here because it is a different
change, and a plan describes one change.

## Revisit when

Any one of these makes the question live again, and none is true today:

- A surface in a repo we own displays a diff to a human in a browser — a Hermes
  console here, or a PR-review view in `apps/site`.
- That surface needs interaction on the diff: line selection, hover, inline
  annotation, or merge-conflict resolution. Static rendering does not qualify;
  Shiki already covers it.
- A file-tree surface exists and outgrows `fumadocs-ui`'s `Files` components.

At that point re-check three things this evaluation could not settle:
`@pierre/trees` reaching a stable release and dropping the pinned Preact
prerelease; whether Turbopack builds cleanly with the package installed; and
whether `/ssr` renders under Node in an RSC without a DOM.

## Not verified

Nothing was installed, so nothing was executed. The `/ssr` module graph contains
no React and guards its custom-element registration, but I did not run
`preloadFile()` under Node to prove it renders without a DOM, and I did not run
`bun run site:build` with the packages installed to measure real Turbopack
output or chunk count. The gzip figures above are the packages' own published
JavaScript compressed as a unit — a good estimate of shipped weight, not a
bundler-verified number. npm download counts are reported as-is and include CI
and mirror traffic.
