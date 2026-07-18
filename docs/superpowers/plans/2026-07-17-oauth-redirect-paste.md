# OAuth Remote-Browser Paste Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let `home gmail/gdrive configure` and `home gcal auth login` complete when the browser runs on a different machine, by accepting the redirect URL (or bare code) pasted into the terminal.

**Architecture:** One new pure helper `parsePastedRedirect` in `src/core/google-auth.ts`, plus a stdin readline raced against the existing loopback HTTP server inside `runInstalledAppOAuth`. First valid code settles the flow. Browser auto-launch is skipped over SSH.

**Tech Stack:** Bun ≥ 1.3, TypeScript, `bun:test`, `node:readline`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-07-17-oauth-remote-redirect-paste-design.md`

## Global Constraints

- TypeScript only; Bun as runtime and test runner (`bun test`, `bun run typecheck`).
- Work directly on `~/Projects/home`, branch `feat/oauth-redirect-paste` (already exists, spec committed). **No worktree** — user's explicit instruction.
- The stdin race lives in the interactive shell section of `google-auth.ts` and is deliberately NOT unit-tested (matches the module's existing comment: the shell "lives apart from the pure, unit-tested helpers").
- All three consumers (gmail/gdrive `configure.ts`, gcal `commands/auth.ts`) call `runInstalledAppOAuth` and must need zero changes.

---

### Task 1: `parsePastedRedirect` pure helper

**Files:**
- Modify: `src/core/google-auth.ts` (add export after `parseAuthRedirect`, which ends at line 276)
- Test: `src/__tests__/google-auth.test.ts` (add a `describe` block after the existing `describe('parseAuthRedirect', …)` block, which ends near line 84)

**Interfaces:**
- Consumes: existing `parseAuthRedirect(rawUrl: string, expectedState: string): { code: string }` and `UserError` from `./errors`.
- Produces: `export function parsePastedRedirect(input: string, expectedState: string): { code: string }` — Task 2 calls this with each stdin line.

- [ ] **Step 1: Write the failing tests**

Add to `src/__tests__/google-auth.test.ts`, after the `parseAuthRedirect` describe block. Also add `parsePastedRedirect` to the existing import list from `'../core/google-auth'`.

```ts
describe('parsePastedRedirect', () => {
  test('accepts a full http redirect URL and validates state', () => {
    expect(
      parsePastedRedirect('http://127.0.0.1:40361/?state=abc&iss=https://accounts.google.com&code=4/0Axyz', 'abc'),
    ).toEqual({ code: '4/0Axyz' })
  })

  test('accepts a full URL with surrounding whitespace', () => {
    expect(parsePastedRedirect('  http://127.0.0.1:9/?state=abc&code=4/0Axyz \n', 'abc')).toEqual({ code: '4/0Axyz' })
  })

  test('rejects a full URL with mismatched state', () => {
    expect(() => parsePastedRedirect('http://127.0.0.1:9/?state=evil&code=c', 'abc')).toThrow(/state mismatch/)
  })

  test('surfaces an error param in a pasted URL', () => {
    expect(() => parsePastedRedirect('http://127.0.0.1:9/?error=access_denied&state=abc', 'abc')).toThrow(
      /access_denied/,
    )
  })

  test('accepts a bare authorization code without state', () => {
    expect(parsePastedRedirect('4/0AXEQxIAkJeCb9HM5xl7D0-7SxH53t5u', 'abc')).toEqual({
      code: '4/0AXEQxIAkJeCb9HM5xl7D0-7SxH53t5u',
    })
  })

  test('rejects garbage input with a paste-the-url hint', () => {
    expect(() => parsePastedRedirect('not a code!!', 'abc')).toThrow(/full redirect URL/)
  })

  test('rejects empty input', () => {
    expect(() => parsePastedRedirect('   ', 'abc')).toThrow(/full redirect URL/)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/__tests__/google-auth.test.ts`
Expected: FAIL — `parsePastedRedirect` is not exported (import error or undefined).

- [ ] **Step 3: Implement `parsePastedRedirect`**

In `src/core/google-auth.ts`, directly after the `parseAuthRedirect` function (after line 276):

```ts
/**
 * Interpret a line the user pasted into the terminal when the loopback
 * redirect couldn't reach this machine (browser on another host). Accepts the
 * full redirect URL from the browser's address bar (state validated, same as
 * the loopback path) or a bare authorization code. A bare code carries no
 * state to check — it is useless without the in-process PKCE verifier, and
 * the user typing it is the consent. Throws `UserError` on anything else.
 */
export function parsePastedRedirect(input: string, expectedState: string): { code: string } {
  const trimmed = input.trim()
  if (/^https?:\/\//.test(trimmed)) return parseAuthRedirect(trimmed, expectedState)
  if (/^[\w/-]+$/.test(trimmed) && trimmed.length > 0) return { code: trimmed }
  throw new UserError(
    "unrecognized input — paste the full redirect URL from the browser's address bar",
    'google_paste_unrecognized',
  )
}
```

Note: `parseAuthRedirect` resolves relative URLs against a dummy origin, so passing an absolute URL through it works as-is; no changes to it.

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/__tests__/google-auth.test.ts`
Expected: PASS (all existing + 7 new).

- [ ] **Step 5: Typecheck and commit**

```bash
bun run typecheck
git add src/core/google-auth.ts src/__tests__/google-auth.test.ts
git commit -m "feat(google-auth): parse pasted redirect URL or bare auth code

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: stdin race in `runInstalledAppOAuth` + SSH browser suppression

**Files:**
- Modify: `src/core/google-auth.ts` — imports (lines 1–4), `tryOpenBrowser` (lines 362–372), `runInstalledAppOAuth` (lines 395–465). Line numbers are pre-Task-1; locate by symbol.

**Interfaces:**
- Consumes: `parsePastedRedirect` from Task 1; existing `exchangeCodeForTokens`, `UserError`, `SystemError`.
- Produces: no signature changes — `runInstalledAppOAuth(opts: InstalledAppFlowOptions): Promise<TokenSet>` behaves identically when stdin is not a TTY.

- [ ] **Step 1: Add the readline import**

At the top of `src/core/google-auth.ts`:

```ts
import { createInterface, type Interface } from 'node:readline'
```

- [ ] **Step 2: Suppress browser launch over SSH**

Replace the body-guard of `tryOpenBrowser` — add as the first line of the function:

```ts
/** Best-effort browser launch; failures are swallowed (the URL is always printed too). */
function tryOpenBrowser(url: string): void {
  // Over SSH, xdg-open would at best fail and at worst open a browser on a
  // forwarded X display the user isn't looking at — the paste fallback is
  // the real path there.
  if (process.env.SSH_CONNECTION || process.env.SSH_TTY) return
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true, shell: process.platform === 'win32' })
    child.on('error', () => {})
    child.unref()
  } catch {
    /* no browser available — the printed URL is the fallback */
  }
}
```

- [ ] **Step 3: Wire the stdin race into `runInstalledAppOAuth`**

Three edits inside the `new Promise` executor:

(a) Declare the readline handle next to `settled` and close it in `finish`:

```ts
    let redirectUri = ''
    let settled = false
    let stdinReader: Interface | undefined
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      server.close()
      stdinReader?.close()
      fn()
    }
```

(b) Extract the code-to-tokens step shared by both paths. Add above `const server = createServer(…)`:

```ts
    const settleWithCode = async (code: string) => {
      const tokens = await exchangeCodeForTokens({
        clientId: opts.clientId,
        clientSecret: opts.clientSecret,
        code,
        redirectUri,
        codeVerifier: verifier,
      })
      return tokens
    }
```

and have the server handler use it (replacing its inline `exchangeCodeForTokens` call):

```ts
      try {
        const { code } = parseAuthRedirect(url, state)
        const tokens = await settleWithCode(code)
        res.writeHead(200, { 'Content-Type': 'text/html' })
        res.end(SUCCESS_HTML)
        finish(() => resolve(tokens))
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'text/html' })
        res.end(errorHtml(err))
        finish(() => reject(err))
      }
```

(c) Start the reader inside the `server.listen` callback, after the existing `notify` lines and before `tryOpenBrowser`:

```ts
      notify('Waiting for authorization…')
      if (process.stdin.isTTY) {
        notify("If the browser can't reach this machine (e.g. you're on SSH), paste the")
        notify('full redirect URL from its address bar here and press Enter.')
        stdinReader = createInterface({ input: process.stdin })
        stdinReader.on('line', (line) => {
          if (settled || !line.trim()) return
          void (async () => {
            try {
              const { code } = parsePastedRedirect(line, state)
              const tokens = await settleWithCode(code)
              finish(() => resolve(tokens))
            } catch (err) {
              // A typo or stale paste shouldn't kill the live flow — report
              // and keep both paths open. Only a spent code (exchange
              // failure) ends it: that authorization is gone either way.
              if (err instanceof UserError) {
                notify(`✗ ${err.message}`)
                return
              }
              finish(() => reject(err))
            }
          })()
        })
      }
      if (openBrowser) tryOpenBrowser(authUrl)
```

- [ ] **Step 4: Full test suite and typecheck**

Run: `bun run typecheck && bun test`
Expected: PASS, no regressions. (No new unit tests — interactive shell, per Global Constraints.)

- [ ] **Step 5: Smoke the non-TTY path**

Run: `echo "" | timeout 5 bun run dev -- gmail configure; echo "exit=$?"`
Expected: prints the consent URL and "Waiting for authorization…" but NOT the paste hint (stdin is a pipe, not a TTY); killed by timeout with exit=124. Confirms non-TTY behavior is unchanged and nothing crashes on piped stdin.

- [ ] **Step 6: Commit**

```bash
git add src/core/google-auth.ts
git commit -m "feat(google-auth): accept pasted redirect URL when browser is remote

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Live verification + install

**Files:** none (verification only; install artifacts are gitignored or outside the repo).

**Interfaces:**
- Consumes: the complete flow from Tasks 1–2; the already-configured shared `google` client on this host.

- [ ] **Step 1: Live end-to-end smoke over the paste path**

This is the user-facing acceptance test and needs the user (their browser is on another machine — exactly the scenario). Run interactively:

Run: `bun run dev -- gmail configure`
Expected: consent URL + paste hint printed; user opens URL on their laptop, browser fails to connect to 127.0.0.1, user pastes the full redirect URL into the terminal; CLI prints `authorized uptonm.dev@gmail.com`.

If the user is not available, pause here — do not fake this step. gcal (`bun run dev -- gcal configure` then `bun run dev -- gcal auth login`) exercises the same path afterward.

- [ ] **Step 2: Install the verified build**

```bash
bun run build:install && home skill install
home gmail status && home gcal status
```

Expected: both exit 0. (`home skill install` is required by CLAUDE.md after any module change; here module manifests are untouched but the reinstall is harmless and keeps the rule unconditional.)
