# `@home/site`

Marketing and Fumadocs documentation for
[home.uptonm.dev](https://home.uptonm.dev).

## Local development

Run from the monorepo root:

```bash
bun install
bun run site:dev
```

Validate the production surface:

```bash
bun run site:typecheck
bun run site:lint
bun run site:build
```

Documentation lives in `content/docs`. Canonical favicon, app-icon, and social
assets live in `../../packages/brand`; the files required by Next.js are
mirrored into `src/app` and `public`.

## Deployment

The Vercel project uses `apps/site` as its Root Directory and deploys from the
`main` branch of
[uptonm/home](https://github.com/uptonm/home). The production domain is
`home.uptonm.dev`.
