---
spec: 004-DOCUMENTATION-PUBLISHING
---

# Repair drift in the two documentation sites

> **NEEDS APPROVAL** — not approved; do not execute.

This plan was written to answer a different question: whether to consolidate the
two documentation sites, and whether to adopt shadscan, fumadocs-starter,
registry.directory, shadcn-storybook-registry, or astro-erudite.

The answer to all six is no. See [Considered and rejected](#considered-and-rejected).

What the investigation did turn up is four concrete defects, three of which are
live in production right now. This plan fixes those and adopts nothing.

## Scope

| # | Defect | Where |
| --- | --- | --- |
| 1 | `docs.uptonm.io` serves a build older than the one on disk | boris, systemd |
| 2 | `~/Projects/docs-site` has no git remote | boris |
| 3 | `public/llms.txt` restates the page list by hand | `apps/site` |
| 4 | No `not-found.tsx` or `error.tsx` boundary | `apps/site` |

Items 1 and 2 touch the host, not this repo. Items 3 and 4 are code changes here.
They are grouped because they are one finding — the documentation surface has
drifted from its sources in four places — and because the spec they serve covers
both sites. They can be executed in either order and neither depends on the other.

## Step 1 — restart `docs-site` so it serves the build on disk

The constraint and the cause are in the spec, under "Known drift". Confirm the
gap before and after rather than trusting the unit's uptime.

```bash
curl -s http://localhost:4600/hermes-profile | grep -c 'Not found'   # expect 1 before
sudo systemctl restart docs-site
curl -s http://localhost:4600/hermes-profile | grep -c 'Not found'   # expect 0 after
systemctl status docs-site --no-pager
```

`restart` is correct here and does not contradict the reload-don't-restart rule,
which governs Caddy. This service has no config to validate and no other consumer;
a restart is the only way to make `next start` pick up a new `.next`.

If the restart alone does not fix `/hermes-profile`, rebuild first — `.next` may
predate the commit:

```bash
cd ~/Projects/docs-site && bun run build && sudo systemctl restart docs-site
```

**Do not touch `/etc/caddy/Caddyfile`.** The `docs.uptonm.io` block is correct
as it stands and the port does not change. Nothing in this plan alters any
hostname, port, or TLS configuration.

## Step 2 — give `docs-site` a remote

Create a private `uptonm/docs-site` on GitHub and push `main`. The repo holds no
content — `~/docs` is out-of-tree and stays that way — so there is no secret to
leak by pushing it. `deploy/docs-site.service` is already committed, which makes
the repo sufficient to rebuild the service on a new box.

```bash
cd ~/Projects/docs-site
gh repo create uptonm/docs-site --private --source=. --remote=origin
git push -u origin main
```

`~/docs` itself remains unbacked-up by this plan. That is a separate decision and
is deliberately out of scope.

## Step 3 — generate `llms.txt` from the Fumadocs loader

`fumadocs-core@16.11.5` already exports `llms` from `fumadocs-core/source/llms`.
No dependency is added.

Delete `apps/site/public/llms.txt` and add a route that derives the same document
from `source`, the way `sitemap.ts` already derives its URL list:

- **New** `apps/site/src/app/llms.txt/route.ts` — builds the index from the
  loader and returns `text/plain`. Keep the hand-written prose header (the
  one-line summary, the canonical/source/docs URLs, and the "Core contract"
  section) as literal text in this file; those are editorial and are not
  derivable. Only the page list comes from `source`.
- **Deleted** `apps/site/public/llms.txt`.

A static file in `public/` wins over a route of the same path, so the deletion is
required, not optional.

Verify the output is unchanged apart from ordering:

```bash
curl -s https://home.uptonm.dev/llms.txt > /tmp/llms.before
bun run site:build && bun run --cwd apps/site start &
curl -s http://localhost:3000/llms.txt > /tmp/llms.after
diff /tmp/llms.before /tmp/llms.after
```

## Step 4 — add the two App Router boundaries

- **New** `apps/site/src/app/not-found.tsx` — 404 page in the site shell, with a
  link back to `/` and to `/docs`.
- **New** `apps/site/src/app/error.tsx` — `"use client"` error boundary with a
  `reset()` retry.

Both reuse the existing `SiteHeader` / `SiteFooter` and shadcn `Button`. Neither
needs new dependencies. This is the only shadscan finding worth acting on, and
it is worth acting on because it is true, not because a tool said it.

## Files touched

| File | Change |
| --- | --- |
| `apps/site/public/llms.txt` | deleted |
| `apps/site/src/app/llms.txt/route.ts` | new |
| `apps/site/src/app/not-found.tsx` | new |
| `apps/site/src/app/error.tsx` | new |
| `docs/specs/004-DOCUMENTATION-PUBLISHING.md` | drop three `NEEDS APPROVAL` markers |

No change to `package.json`, `bun.lock`, `next.config.ts`, `source.config.ts`,
`biome.json`, `.github/workflows/`, `/etc/caddy/Caddyfile`, or any systemd unit
except restarting `docs-site.service`.

## Verification

```bash
bun run site:typecheck   # tsc --noEmit; passes clean today
bun run site:lint        # biome check; 44 files, clean today
bun run site:build       # next build
```

All three pass against the current tree, so any failure is attributable to this
change. Then, by hand:

- `/llms.txt` lists all seven docs pages and keeps the core-contract prose.
- A URL under `/docs` that does not exist renders the new 404, not the default.
- `docs.uptonm.io/hermes-profile` lists the symlinked directory.
- `docs.uptonm.io/home-cli` still renders, confirming the restart broke nothing.

## Rollback

Steps 3 and 4 are a single revert — restore `public/llms.txt` and delete the
three new files. Nothing is stateful and no dependency changes, so `git revert`
is sufficient and Vercel redeploys from `main`.

Step 1 has no rollback and needs none: a restart cannot serve anything other than
the build on disk. If the rebuild in Step 1 produces a broken site, `git stash`
in `~/Projects/docs-site`, rebuild, restart.

Step 2 is reversible with `git remote remove origin` and deleting the GitHub repo.

## Considered and rejected

### Consolidating the two sites into one

**Rejected — the premise is wrong.** The two sites are not duplicates. The
disqualifying constraint is in the spec under "Why it is never public": runtime
MDX over a writable directory is code execution in the server process.

Consolidation has exactly two shapes and both are worse:

- *Serve `~/docs` from `home.uptonm.dev`.* Publishes thirty-five private
  infrastructure notes — IPAM, network topology, credential setup — and moves an
  RCE-adjacent renderer onto the public internet.
- *Move the product docs to `docs.uptonm.io`.* Puts the public documentation for
  a published CLI behind a DNS-only private address, breaking every link in
  `llms.txt`, the installer, and the GitHub README.

A third shape — port `~/docs` into Fumadocs at build time — would end the
live-edit property that is the whole reason `docs-site` exists, and would require
committing personal notes into a repo. The cost is real and the benefit is
"one fewer service".

The two sites cost one systemd unit, one Caddy block, and one four-line unit
file. That is close to the floor. Consolidation would trade a real security
boundary for an aesthetic preference for having one of something.

### shadscan

**Rejected.** It runs fine under Bun — `bunx --bun @shadscan/cli@0.17.0` returned
`0.17.0`, correctly detected `packageManager: bun`, and completed a full scan of
`apps/site` with no project files touched. The package is MIT, pure ESM, has no
install scripts and no native dependencies. Bun compatibility is not the problem.

The problem is that it is wrong about this codebase. Run against `apps/site` it
scores **47/100, grade F**, on 62 findings — 26 pass, 20 not-applicable, 4
advisory, and 12 failures. Reading all twelve:

*False positives caused by not understanding this stack (19 of the 53 lost points):*

- `theme-provider-mounted-in-shell` and `theme-hydration-safe` — the shell does
  mount a theme provider with `attribute: "class"`. It is Fumadocs'
  `RootProvider`, which wraps `next-themes` and takes its config as a `theme`
  prop object rather than as JSX attributes on a literal `ThemeProvider`.
- `command-menu-present` and `command-menu-hotkey-present` — Fumadocs ships the
  Cmd+K command menu, and `/api/search` answers queries in production.
- `icon-buttons-have-labels` at `site-header.tsx:64` — the button carries
  `aria-label="home on GitHub"` on the element passed through Base UI's `render`
  prop. Biome already analysed this exact line; the `biome-ignore` comment
  directly above it explains why. The tool re-raises a question that was asked
  and answered, without understanding the pattern.

*Prescriptive taste, not defects (14 points):* `toast-provider-present`,
`toast-provider-mounted` (which contradicts the former), `theme-hotkey-present`,
and `button-icons-have-data-icon`. A seven-page documentation site does not need
a toast runtime or a dark-mode hotkey.

*Genuinely true (6 points):* `not-found-route-present` and `error-boundary-present`
— fixed in Step 4 above, as a twenty-line change rather than a dependency.

The `states` category scores 0/20 because a static content site has no loading,
empty, or retry states to have. That alone is a fifth of the grade.

On overlap: of its 62 rules, about 8 duplicate Biome rules we already run, and on
every one Biome is stronger — shadscan short-circuits after the first violation
per rule, so it reports one occurrence and stops, and it offers no autofix and no
suppression mechanism. Meanwhile it implements none of roughly 25 Biome a11y
rules we already get, including `noSvgWithoutTitle` and `useSemanticElements`.
Overlap with `tsc --noEmit` is negligible.

Its genuinely non-overlapping category is app-completeness scoring — "does this
app have a command menu, a toast provider, an empty state" — which is exactly the
category where it is either wrong about us or prescribing features we do not want.

Maturity compounds this. The repo is about two months old and published 19 stable
versions in the 24 days to 2026-08-15; `playwright-core` appeared as a dependency
at 0.14.0, five days before the latest release, expanding scope from static
analysis into browser automation. It is one maintainer, 335 of 338 commits, no
institutional backing, and its own CI matrix tests Node 18 and 26 on Linux and
Windows — Bun support is a documented claim with no regression test behind it.
Gating CI on a `--fail-under` score from a tool on that release cadence means
chasing a moving target weekly for a site with no forms.

Worth revisiting if `apps/site` ever grows real application surface — forms,
authenticated views, async states — and if the project reaches 1.0 with a stable
ruleset.

### fumadocs-starter

**Rejected as an adoption; two patterns noted for later.** MIT, 66 stars, but the
last commit was 2026-04-08 and it targets `fumadocs-mdx` ^14, a full major behind
our ^15.2.0 — its `source.config.ts`, which is where its best work lives, is
written against a config API we do not have.

Two ideas in it are worth stealing on their own merits, and neither needs this
plan: content negotiation via `fumadocs-core/negotiation` so `/docs/*` serves raw
markdown to clients that ask for it, and an RSS feed. Both are self-contained and
belong in their own plan if wanted. Its llms.txt route confirmed the built-in
`llms()` helper used in Step 3 — which is the one thing from it this plan
actually acts on, and it comes from `fumadocs-core`, not from the starter.

### registry.directory

**Rejected — it is a website, not a dependency.** Nothing is published to npm;
the repo is a private Turborepo behind https://registry.directory. Its only
installable surface is an aggregated `/r/*` endpoint that proxies other people's
registries through a third party's Vercel deployment. Adding that to
`components.json` would put a supply-chain hop between us and any component we
install. Fine as a bookmark; not a repo change.

### shadcn-storybook-registry

**Rejected — YAGNI, and the local evidence is discouraging.** It is well-run
(MIT, 179 stars, ~64 story items covering the shadcn set), but it ships story
files only. Consuming it requires first installing Storybook 10, a Vite builder,
and two or three addons, and hand-editing the framework import in each story file
if not on `@storybook/nextjs-vite`. Files are copied in, not linked, so
re-running `shadcn add` overwrites local edits and component drift is ours to
absorb.

`apps/site` has eight shadcn primitives and eleven bespoke section components,
all consumed by one seven-page site with a single reader-facing layout. A
component workbench solves a problem this repo does not have.

The homelab already ran this experiment. `storybook.atlas.uptonm.io` and
`dev.storybook.atlas.uptonm.io` still resolve, two containers
(`atlas-ui-storybook-1`, `atlas-ui-storybook-dev-1`) have been up for two weeks,
and two Caddy blocks still point at ports 8080 and 6006 — while
`~/Projects/atlas` no longer exists on disk. The Storybook outlived the repo it
documented and is now unowned infrastructure nobody can rebuild. That is the
ongoing cost, observed rather than predicted.

### astro-erudite

**Rejected on sight.** MIT, 849 stars, actively maintained, and entirely
irrelevant: it is an Astro project template, not a package, and every dependency
is Astro-coupled. Adopting it means rewriting `apps/site` off Next and Fumadocs
to gain a blog theme. Not on the table.

### Deriving the module list from the CLI registry

**Rejected as out of scope, noted in the spec.** The seventeen modules are stated
in `registry.ts`, `module-grid.tsx`, and `modules.mdx`, and all three currently
agree. Generating the latter two from the former is a genuine improvement and a
genuine piece of work — the site would need build-time access to the CLI's
manifest, and the grid additionally carries editorial grouping and icons that are
not in the registry. It belongs in its own plan, with its own justification, not
smuggled into a drift-repair change.
