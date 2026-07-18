# OAuth remote-browser fallback: paste the redirect URL

**Date:** 2026-07-17
**Status:** approved

## Problem

`runInstalledAppOAuth` (`src/core/google-auth.ts`) drives Google's
installed-app flow by starting a loopback HTTP server on
`127.0.0.1:<ephemeral>` and waiting for the consent redirect. When the user's
browser runs on a different machine than the CLI (the common case: SSH'd into
the homelab box from a laptop), the redirect to `127.0.0.1` resolves to the
*laptop*, the callback never arrives, and the flow times out after 5 minutes —
even though the full redirect URL, containing the authorization code, is
sitting in the browser's address bar.

Today the only workaround is manually replaying that URL against the loopback
port from the CLI host. The CLI should accept it directly.

## Rejected alternatives

- **Google device flow** (`google.com/device` + short code): Google restricts
  device-flow scopes to a small allowlist that excludes `gmail.readonly`,
  `drive.readonly`, and the calendar scopes. Dead end.
- **LAN-reachable redirect URI** (bind `0.0.0.0`, redirect to the host's LAN
  IP): Google only permits loopback (`localhost`/`127.0.0.1`) redirect URIs
  for Desktop-app clients. Dead end.

## Design

Race stdin against the loopback server inside `runInstalledAppOAuth`.
Whichever produces a valid authorization code first settles the flow; the
loser is torn down. The same-machine happy path is unchanged.

### Input normalization (pure, unit-tested)

New helper in `google-auth.ts`:

```
parsePastedRedirect(input: string, expectedState: string): { code: string }
```

- Trimmed input starting with `http://` or `https://` → delegate to the
  existing `parseAuthRedirect` (state validated, `error` param surfaced).
- Trimmed input matching a bare authorization code (`^[\w\/-]+$`, Google codes
  look like `4/0A…`) → accept as the code directly. No state to check — a bare
  code is useless to an attacker without the in-process PKCE verifier, and the
  user typing it *is* the consent.
- Anything else → `UserError` telling the user to paste the full URL from the
  browser's address bar.

### Interactive shell changes (thin, untested by design — same as today)

In `runInstalledAppOAuth`:

- After printing the auth URL, if `process.stdin.isTTY`, print one more line:
  “If the browser can't reach this machine (e.g. you're on SSH), paste the
  full redirect URL from its address bar here and press Enter.”
  and start a `readline` interface on stdin.
- On each line: run `parsePastedRedirect`; on `UserError` print the message
  and keep listening (typos shouldn't kill the flow); on success run the
  existing `exchangeCodeForTokens` and settle.
- `finish()` additionally closes the readline interface (and is the single
  settle point for both paths, as today).
- When stdin is not a TTY, skip all of this — behavior identical to current.

### Browser-launch suppression over SSH

`tryOpenBrowser` is skipped when `SSH_CONNECTION` or `SSH_TTY` is set —
launching `xdg-open` in an SSH session is at best noise, at worst opens a
browser on the wrong machine's X forward.

## Error handling

- Pasted URL with mismatched `state` → existing `google_state_mismatch`
  UserError, printed, flow keeps waiting (a stale paste from a previous
  attempt shouldn't abort the current one). This is a deliberate softening:
  on the *loopback* path a state mismatch still aborts, since it can indicate
  CSRF; on the paste path the user is the channel.
- Code-exchange failure after a paste (expired/reused code) → existing
  `google_code_exchange_failed` SystemError; this settles the flow (the
  authorization is spent — user must re-run configure).
- Timeout, denial, and loopback behavior unchanged.

## Testing

- Unit tests for `parsePastedRedirect`: full URL happy path, URL with bad
  state, URL with `error=access_denied`, bare code, whitespace-padded input,
  garbage input.
- No tests for the stdin race itself — it lives in the interactive shell that
  is already explicitly excluded from unit testing (see module comment).

## Scope

- One file changed (`src/core/google-auth.ts`) plus its test file. All three
  consumers (gmail configure, gdrive configure, `gcal auth login`) inherit
  the fallback with no changes.
- Orthogonal to the google-cred-consolidation stack (PRs #68–#83): this
  touches auth transport, not credential storage — but expect a textual merge
  conflict in `google-auth.ts`; land this small and first.
