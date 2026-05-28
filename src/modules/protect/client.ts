import './undici-patch'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { ProtectApi } from 'unifi-protect'
import type { ModuleConfig } from '../../core/types'
import { paths } from '../../core/paths'

// The SDK is chatty (WebSocket parse warnings on every call, "API error"
// log lines on transient retryable failures). We surface real failures via
// our own RunResult shape, so silence the SDK's logger entirely. Set
// `HOME_PROTECT_DEBUG=1` to bring it back to stderr.
const debug = process.env.HOME_PROTECT_DEBUG === '1'
const stderrLogger = {
  debug: (msg: string) => debug && process.stderr.write(`[protect] ${msg}\n`),
  info: (msg: string) => debug && process.stderr.write(`[protect] ${msg}\n`),
  warn: (msg: string) => debug && process.stderr.write(`[protect:warn] ${msg}\n`),
  error: (msg: string) => debug && process.stderr.write(`[protect:error] ${msg}\n`),
}

export interface ProtectConfig {
  url: string
  host: string
  username: string
  password: string
  insecureTLS?: boolean
}

export function readProtectConfig(cfg: ModuleConfig): ProtectConfig {
  const url = String(cfg.url ?? '').replace(/\/+$/, '')
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
  return {
    url,
    host,
    username: String(cfg.username ?? ''),
    password: String(cfg.password ?? ''),
    insecureTLS: Boolean(cfg.insecureTLS),
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

// Protect throttles rapid successive logins. We track the last successful
// connect's timestamp in a state file and enforce a minimum interval before
// each new connect — this proactively avoids the throttle.
const STATE_FILE = `${paths.configRoot}/.protect-last-call`
// UniFi Protect throttles ~5 rapid logins. We saw single-call recovery
// after ~5s of idle, so 3s between calls is enough margin and keeps the
// per-command latency reasonable. Override via env if needed.
const MIN_INTERVAL_MS = Number(process.env.HOME_PROTECT_INTERVAL_MS ?? 3000)

async function paceConnect(): Promise<void> {
  try {
    if (!existsSync(STATE_FILE)) return
    const last = Number(readFileSync(STATE_FILE, 'utf8'))
    if (!last || Number.isNaN(last)) return
    const sinceMs = Date.now() - last
    if (sinceMs >= MIN_INTERVAL_MS) return
    await sleep(MIN_INTERVAL_MS - sinceMs)
  } catch {
    /* missing/unreadable state file is fine */
  }
}

function markConnect(): void {
  try {
    writeFileSync(STATE_FILE, String(Date.now()))
  } catch {
    /* not fatal */
  }
}

export async function connect(cfg: ProtectConfig): Promise<ProtectApi> {
  // Bun's Pool doesn't honor the SDK's `connect.rejectUnauthorized: false`.
  // The user has explicitly opted into self-signed via insecureTLS, so set
  // the env var that Node's TLS layer respects, scoped to this process.
  if (cfg.insecureTLS) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }
  await paceConnect()
  // Our compose patch nukes the SDK's interceptor-based retry, so we
  // implement our own around login + bootstrap. UniFi Protect throttles
  // rapid successive logins; the pacing above is the primary mitigation,
  // and this retry is the safety net if it isn't enough.
  const maxAttempts = 6
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const api = new ProtectApi(stderrLogger)
    try {
      const loggedIn = await api.login(cfg.host, cfg.username, cfg.password)
      if (!loggedIn) throw new Error(`Protect login returned false (attempt ${attempt})`)
      const booted = await api.getBootstrap()
      if (!booted) throw new Error(`Protect bootstrap failed (attempt ${attempt})`)
      markConnect()
      return api
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        // 800ms, 1.6s, 3.2s, 6.4s, 8s (capped) — ~20s worst case before throw
        const delay = Math.min(800 * 2 ** (attempt - 1), 8000)
        await sleep(delay)
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`Protect login failed for ${cfg.host}`)
}

export async function withApi<T>(cfg: ProtectConfig, fn: (api: ProtectApi) => Promise<T>): Promise<T> {
  const api = await connect(cfg)
  return fn(api)
}
