---
plans: [004-DOCS-PUBLISHING-DRIFT-REPAIR]
---

# Documentation publishing

Two documentation sites exist. They are not duplicates and are not candidates
for consolidation: they sit on opposite sides of a trust boundary, source
different content, and serve different readers.

| | `home.uptonm.dev` | `docs.uptonm.io` |
| --- | --- | --- |
| Repo | `~/Projects/home` → `apps/site` | `~/Projects/docs-site` |
| Content | `apps/site/content/docs` (in-repo) | `~/docs` (out-of-repo) |
| Audience | Public — users of the `home` CLI | One author, on the LAN |
| Rendering | Fumadocs, MDX compiled at build time | MDX compiled per request |
| Hosting | Vercel | systemd on boris, behind host Caddy |
| Reachability | Public internet, Cloudflare-proxied | `10.0.14.60`, DNS-only |

## `home.uptonm.dev` — the product site

The public marketing and documentation surface for the `home` CLI. It is a
Bun workspace, `@home/site`, at `apps/site`.

### Stack

Next 16.2.10 and React 19.2.4, with `fumadocs-ui` and `fumadocs-core` 16.11.5
and `fumadocs-mdx` 15.2.0. Styling is Tailwind 4 plus shadcn components in the
`base-nova` style over `@base-ui/react` 1.6.0. `next-themes` provides the theme,
mounted through Fumadocs' `RootProvider` rather than a bare `ThemeProvider`.

### Content

Seven MDX pages under `content/docs`, ordered explicitly by `content/docs/meta.json`:
`index`, `getting-started`, `configuration`, `modules`, `agent-skills`,
`operations`, `development`. `fumadocs-mdx` generates `.source/` in a `pre*`
script before every `dev`, `build`, and `typecheck`; that directory is
gitignored build output.

The root route is a marketing landing page composed of eight section components
under `src/components/site`. Documentation lives under `/docs`, rendered by a
catch-all route that uses `generateStaticParams`, so docs pages are static at
build time.

### Search

Search is real and live. `src/app/api/search/route.ts` is a two-line
`createFromSource(source)` over `fumadocs-core/search/server`, backed by Orama,
and Fumadocs' `RootProvider` supplies the Cmd+K dialog that queries it. The
endpoint returns indexed headings and page hits in production.

### Clerk is a kill switch, not reader authentication

`@clerk/nextjs` is present but does not gate readers. `proxy.ts` returns early
unless `VERCEL_ENV === "production"`, then consults `isAppGated()` in
`src/lib/gates.ts`, which reads `publicMetadata.gates[GATES_APP_ID]` from a
Clerk organization and caches the answer for 60 seconds. The site is public
whenever that flag is false. Its purpose is to let a fleet operator take the
site private from Clerk without a redeploy.

### SEO and machine-readable surfaces

`src/app/sitemap.ts` derives its URL list from `source.getPages()`, so it cannot
drift from the content. `robots.ts`, a JSON-LD `SoftwareApplication` block in the
root layout, an OG image, and a web manifest are all present. Brand assets are
owned by `packages/brand` and mirrored into `src/app` and `public`.

`public/llms.txt` is a hand-written static file that restates the page list and
the CLI's core contract.

> **NEEDS APPROVAL** — [`004-DOCS-PUBLISHING-DRIFT-REPAIR`](../plans/004-DOCS-PUBLISHING-DRIFT-REPAIR.md)
> `llms.txt` is generated from the Fumadocs loader by `fumadocs-core/source/llms`,
> which is already installed, so the page list has exactly one source.

### Deployment

Vercel project `home` (`prj_nj4Rdy5a5ZZfnYw4o01Uw7NAut0s`), root directory
`apps/site`, deploying from `main` of `uptonm/home`. `home.uptonm.dev` resolves
to Cloudflare (`172.67.141.160`, `104.21.94.241`) and is proxied — unlike
`uptonm.io`, which must stay DNS-only.

`/install.sh` is a 307 redirect to `scripts/install.sh` on raw GitHub, keeping
the installer in one place.

### Verification

`.github/workflows/ci.yml` runs `bun run typecheck`, `bun run test`,
`bun run site:lint`, and `bun run site:build` on every pull request under Bun
1.3.14. `site:lint` is `biome check`; `site:typecheck` is `tsc --noEmit`. Both
pass clean against the current tree.

The site has no forms, inputs, labels, selects, or textareas anywhere in
`src`. Its interactive surface is one theme toggle, one copy-to-clipboard
button, and a handful of links, across roughly 2,100 lines of TypeScript.

> **NEEDS APPROVAL** — [`004-DOCS-PUBLISHING-DRIFT-REPAIR`](../plans/004-DOCS-PUBLISHING-DRIFT-REPAIR.md)
> `src/app/not-found.tsx` and `src/app/error.tsx` give the App Router explicit
> 404 and error boundaries instead of the framework defaults.

## `docs.uptonm.io` — the personal knowledge base

A self-hosted viewer that renders the folder tree under `~/docs` at request
time. Its design is recorded in `~/Projects/docs-site/docs/superpowers/`, which
is frozen history and is never edited.

### How it works

One catch-all route reads disk on every request — that is the entire
live-update mechanism. Drop a `.md` or `.mdx` file under `~/docs`, refresh, and
it is live; there is no build step, watcher, or content pipeline. Navigation,
titles, and ordering derive from the filesystem. Compiled output is memoized in
process, keyed by absolute path and mtime.

`.md` compiles in markdown mode and `.mdx` in MDX mode, so a stray `<` in an old
note is never a JSX parse error. Path resolution guards traversal by resolving
then prefix-checking against the root, and permits symlinks only at the top
level, as directories.

The site is Next 16.2.10 and React 19.2.4 with shadcn components — it does not
use Fumadocs. It has no full-text search; that was an explicit v1 non-goal.

### Content

`DOCS_ROOT=/home/mikeupton/docs`, which holds 35 markdown files across `atlas/`,
`ccrc/`, `hermes/`, `home-cli/`, `infra/`, and `plans/`, plus `hermes-profile`,
a top-level symlink to `~/.hermes/docs`. Content never lives in the repo.

### Deployment

`docs-site.service` runs `bun run start` as `mikeupton` with `PORT=4600`,
enabled at boot and restarting on failure. The Caddy block is the plain house
pattern:

```caddy
docs.uptonm.io {
	import tls_cloudflare
	reverse_proxy http://localhost:4600
}
```

There is no `remote_ip` matcher. **LAN-only is enforced solely by DNS**:
`docs.uptonm.io` resolves to `10.0.14.60` and `uptonm.io` is never
orange-clouded. Orange-clouding the zone would expose this site, which is why
that rule is load-bearing rather than cosmetic.

### Why it is never public

Runtime MDX compilation means write access to `~/docs` is code execution in the
server process. That is acceptable for a single-author LAN box and disqualifying
for anything reachable from the internet. This is the reason the two sites
cannot merge, and it is a property of the architecture, not a policy that can be
relaxed.

### Known drift

The service has been running continuously since 2026-07-31. The repo's most
recent commit, `357667a feat: support top-level symlinked docs mounts`, landed
2026-08-04 and its build is on disk in `.next`, but the process still holds the
build it loaded at start. `/hermes-profile` therefore renders the not-found page
against a symlink the current code supports.

The repo has no git remote. It exists only on boris.

> **NEEDS APPROVAL** — [`004-DOCS-PUBLISHING-DRIFT-REPAIR`](../plans/004-DOCS-PUBLISHING-DRIFT-REPAIR.md)
> The service runs the build on disk, so `/hermes-profile` lists its contents,
> and the repo has an origin so it survives the loss of the box.

## What the two sites share, and what they do not

They share a visual vocabulary — shadcn `base-nova`, `@base-ui/react`, Tailwind
4, `next-themes`, `lucide-react`, Biome — arrived at independently rather than
through a shared package. They share no code, no content, and no deployment.

`~/docs/home-cli/` and `apps/site/content/docs` both concern the `home` CLI but
differ in kind: the former holds fourteen internal design and gap-closure plans,
the latter is the public user manual. Neither is a copy of the other. New
planning work for this repo goes in `docs/specs` and `docs/plans` under the
convention in `docs/README.md`, which supersedes `~/docs/home-cli/` for anything
written from now on; the existing files there remain as history.

The module list is stated three times — `apps/home/src/registry.ts`,
`apps/site/src/components/site/module-grid.tsx`, and
`apps/site/content/docs/modules.mdx` — and all three currently agree on the same
seventeen modules. Only the first is executable, so the other two are drift
risks that no check would catch.

## No component-audit, registry, or Storybook tooling

The site depends on Fumadocs, shadcn, Base UI, Tailwind, and Biome. It takes no
component-audit, registry-browsing, or story-authoring dependency, and there is
no Storybook anywhere in the repo. The reasoning is recorded in
[`004-DOCS-PUBLISHING-DRIFT-REPAIR`](../plans/004-DOCS-PUBLISHING-DRIFT-REPAIR.md).
