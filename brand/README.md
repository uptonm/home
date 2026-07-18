# `home` brand kit

`home` is one command surface for a homelab: services, operations, and
agent-ready skills behind a single CLI.

The mark combines a house and terminal prompt inside the shared Uptonm product
frame. The gold corner bracket and diamond establish the family resemblance;
the cyan roof and prompt distinguish `home` as the product that connects local
systems.

## Assets

| File | Size | Intended use |
| --- | ---: | --- |
| `home-mark.svg` | Vector | Master mark and documentation-site source |
| `icon.png` | 512×512 | Next.js App Router `icon.png` |
| `apple-icon.png` | 180×180 | Next.js App Router `apple-icon.png` |
| `favicon.ico` | 16/32/48px | Browser favicon |
| `icon-192.png` | 192×192 | Web app manifest |
| `icon-512.png` | 512×512 | Web app manifest and high-resolution usage |
| `og.png` | 1200×630 | Website Open Graph and Twitter card |
| `github-social-preview.png` | 1280×640 | GitHub repository social preview |
| `source/social-background.png` | Raster source | Illustration source for the social-card exports |

For a Next.js App Router site, copy `icon.png`, `apple-icon.png`, and
`favicon.ico` into `src/app/`; copy `icon-192.png`, `icon-512.png`, and
`og.png` into `public/`.

## Palette

| Token | Hex | Role |
| --- | --- | --- |
| Warm black | `#12100e` | Primary field and icon surface |
| Signal gold | `#d7a94b` | Family frame, markers, and emphasis |
| Warm ivory | `#f5f1e8` | Primary content and house silhouette |
| Network cyan | `#5fb8cb` | `home` product accent and connection signal |
| Muted stone | `#aaa097` | Secondary copy on dark surfaces |

## Usage

- Preserve the transparent pixels outside the rounded frame. Do not add a white
  matte or flatten the icon onto an opaque square.
- Keep clear space around the mark equal to at least one corner-diamond width.
- Use the full mark at 32px and above. Use `favicon.ico` below 32px.
- Keep the tagline as **One CLI for the homelab.**
- Use `home` in lowercase and set product-name typography in a monospaced face.
- Do not recolor individual parts, remove the family markers, add vendor logos,
  or place the mark over a visually busy background.

## Rebuilding

The icon exports are drawn deterministically from the same geometry as
`home-mark.svg`. The social cards combine exact typography with the committed
illustration source:

```bash
/path/to/python3 brand/build.py
```

The build requires Pillow. It uses the macOS SF Mono fonts when run from the
project's current design environment.
