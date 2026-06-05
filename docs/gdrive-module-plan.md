# Google Drive Module Plan (greenfield)

Plan for a **new `gdrive` module** — Drive API (`www.googleapis.com/drive/v3`) —
with the same `list`/`get`-first shape as the existing modules: scaffold +
shared Google OAuth, the entity spine (files + download/export), then write.

> Separate diff from the Google Chat and Gmail plans, but all three share
> `core/google-auth`; whichever lands first builds it.

---

## New-module scaffold (Phase 0)

- `src/modules/gdrive/{index,client,configure}.ts` (mirrors `src/modules/spotify`).
- `requestJson` against Drive v3 with a bearer token from `core/google-auth`
  (shared three-legged auth-code + refresh helper — see the Google Chat plan).
- Register manifest in `src/registry.ts`.
- `status()` → `GET /drive/v3/about?fields=user,storageQuota` (auth probe +
  storage summary).

**Auth scopes (read spine):** `drive.readonly` (list/get/download/export). Write
adds `drive.file` (app-created files) or `drive` (full). Default least-privilege
read; request write only when Phase 2 commands are used.

---

## Phase 1 — Files entity spine (list/get/download/export)

Drive's analog to Gmail's `q` is the **files `q` query language**
(`name contains 'x'`, `mimeType='application/pdf'`, `'<folderId>' in parents`,
`modifiedTime > '…'`, `trashed=false`). Surface it on `files list`.

| # | Command | Endpoint | Kind |
|---|---|---|---|
| 1 | `files list [--q] [--order-by] [--drive <id>]` | `GET /files` (`fields`, `pageToken`, `supportsAllDrives`, `includeItemsFromAllDrives`) | list (paged) |
| 2 | `files get <id>` | `GET /files/{id}?fields=*` | get (metadata) |
| 3 | `files download <id> [--out]` | `GET /files/{id}?alt=media` | bytes → file/stdout (parallels `protect snapshot`) |
| 4 | `files export <id> --mime <type> [--out]` | `GET /files/{id}/export?mimeType=` | Google-native (Docs/Sheets/Slides) → pdf/docx/xlsx/etc. |

`files` resolution: accept a file by id or by `name`-substring (resolve via a
scoped `files list`), mirroring the other modules' resolvers; ambiguous → list
candidates.

> **Native vs binary:** `download` (`alt=media`) works for uploaded/binary files;
> Google-native docs **must** use `export` with a target MIME. The `download`
> command should detect a native `mimeType` and point the user at `export`.

### Phase 1 PR breakdown (stackable)

1. PR: scaffold + `core/google-auth` + `files list/get` (+ `--q`).
2. PR: `files download` + `files export` (+ native-vs-binary handling).

---

## Phase 2 — Related entities (list/get)

| # | Command | Endpoint |
|---|---|---|
| 5 | `drives list/get` (shared drives) | `GET /drives`, `/drives/{id}` |
| 6 | `permissions list <fileId>` | `GET /files/{id}/permissions` |
| 7 | `revisions list/get <fileId>` | `GET /files/{id}/revisions` (+ `/{revId}`) |
| 8 | `comments list <fileId>` | `GET /files/{id}/comments` |
| 9 | `about` | `GET /about` (storage quota, user, import/export formats) |
| 10 | `changes list` | `GET /changes` (+ `getStartPageToken`) — incremental sync |

### Phase 2 PR breakdown

1. PR: `drives list/get` + `about`.
2. PR: `permissions list` + `revisions list/get` + `comments list`.

---

## Phase 3 — Write (outward-facing; confirmation-gated)

| Command | Endpoint | Notes |
|---|---|---|
| `upload <path> [--parent] [--name]` | `POST /upload/drive/v3/files?uploadType=multipart` | create/upload |
| `mkdir <name> [--parent]` | `POST /files` (`mimeType=…folder`) | |
| `files copy <id>` / `files move <id> --to` | `POST /files/{id}/copy`, `PATCH /files/{id}?addParents&removeParents` | |
| `files trash <id>` | `PATCH /files/{id}` `{trashed:true}` | reversible; deletes via `DELETE` should be extra-gated |
| `share <fileId> --email --role` | `POST /files/{id}/permissions` | **sharing publishes access** — confirm explicitly, surface the resulting link |

> `share`, `upload`, and `DELETE` are hard-to-reverse / outward-facing — gate
> behind explicit confirmation per harness norms; `share` especially (it grants
> external access). Never auto-share or hard-delete.

---

## Coverage target

| Entity | list | get | download/export | write |
|---|---|---|---|---|
| files | ✅ (`q`) | ✅ | ✅ download + export | upload/copy/move/trash |
| drives (shared) | ✅ | ✅ | — | — |
| permissions | ✅ | — | — | share |
| revisions | ✅ | ✅ | — | — |
| comments | ✅ | — | — | — |
| about | — | ✅ | — | — |

---

## Open items to confirm at implementation time

- **`core/google-auth`** — shared with Chat/Gmail; scope list is the only diff.
- **Shared-drive params** — `supportsAllDrives` + `includeItemsFromAllDrives`
  must be set on list/get for shared-drive items to appear; confirm defaults.
- **Export MIME map** — build a small native-type → export-MIME table (Doc→pdf/
  docx, Sheet→xlsx/csv, Slides→pdf/pptx) for `files export` ergonomics.
- **`fields` masks** — Drive returns sparse objects unless `fields` is set;
  default to a sensible field set per command and allow `--fields` override.
