/**
 * authenticated-socket transport: one-shot Socket.IO session against Uptime
 * Kuma 1.23.x — connect, login, collect the initial state burst, disconnect.
 * No daemon, no reconnection, one attempt per CLI invocation.
 *
 * Event inventory pinned against the 1.23.X branch (github.com/louislam/uptime-kuma),
 * cross-checked against a live 1.23.17 instance where noted:
 *  - on connection the server emits `info` with version fields hidden
 *    (server.js `sendInfo(socket, true)` — captured live: only primaryBaseURL,
 *    serverTimezone, serverTimezoneOffset arrive pre-auth)
 *  - `login` (server.js socket.on("login")): payload {username, password, token};
 *    ack {ok: true, token} on success, {tokenRequired: true} when the account
 *    has 2FA enabled, {ok: false, msg} on bad credentials / rate limit
 *  - afterLogin (server.js) pushes, in order: monitorList, info (now with
 *    version), maintenanceList, notificationList, proxyList, dockerHostList,
 *    apiKeyList, then after a 500ms sleep statusPageList, heartbeatList per
 *    monitor, importantHeartbeatList per monitor, and per monitor
 *    avgPing / uptime(24) / uptime(720) / certInfo (monitor.js `sendStats`)
 *  - `monitorList`: object keyed by monitor id → monitor.toJSON()
 *    (uptime-kuma-server.js `getMonitorJSONList`)
 *  - `heartbeatList`: (monitorID, rows, overwrite) — the newest ≤100 raw DB
 *    rows oldest→newest (client.js `sendHeartbeatList`, LIMIT 100); unlike the
 *    public route, `msg` is not blanked
 *  - `uptime`: (monitorID, hours, ratio 0..1) (monitor.js `sendUptime`)
 *  - `certInfo`: (monitorID, infoJson) — monitor_tls_info.info_json as a JSON
 *    *string* the frontend JSON.parses (monitor.js `sendCertInfo`; only sent
 *    for monitors with stored TLS info)
 *  - `maintenanceList`: object keyed by id → maintenance.toJSON(), which is
 *    exactly toPublicJSON (model/maintenance.js) — but includes *all* windows
 *    with their computed `status`, not just active ones
 *  - no incident event exists on the authenticated socket in 1.23.x; pinned
 *    incidents are served only by the public status-page routes
 */
import { io } from 'socket.io-client'
import { SystemError, UserError } from '../../core/errors'
import type {
  KumaConfig,
  KumaTransport,
  RawCertEntry,
  RawHeartbeat,
  RawHeartbeatPayload,
  RawStatusPage,
} from './client'

/** Kuma series this transport was written and tested against (major.minor). */
export const TESTED_KUMA_VERSION = '1.23'

export interface KumaSocketLike {
  on(event: string, listener: (...args: unknown[]) => void): void
  emit(event: string, payload: unknown, ack: (response: unknown) => void): void
  disconnect(): void
}

export interface KumaSocketConnectOptions {
  connectTimeoutMs: number
  insecureTLS: boolean
}

export type KumaSocketConnect = (url: string, opts: KumaSocketConnectOptions) => KumaSocketLike

export interface KumaSocketTimings {
  /** Deadline for the Socket.IO connection to establish. */
  connectMs: number
  /** Deadline for the login ack after emitting the login event. */
  loginMs: number
  /** Hard cap on collecting the post-login burst. */
  settleCapMs: number
  /** Trailing window after the settle condition, catching the last monitor's certInfo. */
  settleGraceMs: number
}

const DEFAULT_TIMINGS: KumaSocketTimings = { connectMs: 10_000, loginMs: 10_000, settleCapMs: 5_000, settleGraceMs: 250 }

function realConnect(url: string, opts: KumaSocketConnectOptions): KumaSocketLike {
  return io(url, {
    transports: ['websocket'],
    reconnection: false,
    timeout: opts.connectTimeoutMs,
    ...(opts.insecureTLS ? { rejectUnauthorized: false } : {}),
  })
}

let connectImpl: KumaSocketConnect = realConnect
let timingsImpl: KumaSocketTimings = DEFAULT_TIMINGS

/** Test seam — the socket-mode analogue of the fetch stubbing in the public-transport tests. */
export function setKumaSocketOverrides(
  overrides: { connect?: KumaSocketConnect; timings?: Partial<KumaSocketTimings> } | null,
): void {
  connectImpl = overrides?.connect ?? realConnect
  timingsImpl = { ...DEFAULT_TIMINGS, ...overrides?.timings }
}

/** One authenticated instance's initial burst, frozen at collection time. */
export interface KumaSnapshot {
  serverVersion: string | null
  /** monitor.toJSON() records keyed by stringified monitor id. */
  monitors: Record<string, Record<string, unknown>>
  beatsByMonitor: Record<string, RawHeartbeat[]>
  /** 24h uptime ratios (0..1) keyed by monitor id. */
  uptime24ByMonitor: Record<string, number>
  certsByMonitor: Record<string, RawCertEntry>
  maintenances: unknown[]
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function boundedDetail(v: unknown): string {
  const message = v instanceof Error ? v.message : String(v)
  return message.slice(0, 200)
}

function assertTestedVersion(serverVersion: string | null, cfg: KumaConfig): void {
  if (serverVersion === null || cfg.allowUnsupported) return
  const majorMinor = serverVersion.match(/^(\d+\.\d+)/)?.[1]
  if (majorMinor === TESTED_KUMA_VERSION) return
  throw new UserError(
    `Uptime Kuma ${serverVersion} is outside the tested ${TESTED_KUMA_VERSION}.x series — set allowUnsupported=true in the module config to proceed anyway`,
    'kuma_untested_version',
  )
}

export function collectKumaSnapshot(cfg: KumaConfig): Promise<KumaSnapshot> {
  const timings = timingsImpl
  const socket = connectImpl(cfg.url, {
    connectTimeoutMs: timings.connectMs,
    insecureTLS: Boolean(cfg.insecureTLS),
  })
  const timers: ReturnType<typeof setTimeout>[] = []
  const later = (fn: () => void, ms: number): void => {
    timers.push(setTimeout(fn, ms))
  }

  const collected = new Promise<KumaSnapshot>((resolve, reject) => {
    let settled = false
    let connectedOk = false
    let loginAcked = false
    let loginOk = false
    let graceScheduled = false

    let serverVersion: string | null = null
    let monitors: Record<string, Record<string, unknown>> | null = null
    const beatsByMonitor: Record<string, RawHeartbeat[]> = {}
    const uptime24ByMonitor: Record<string, number> = {}
    const certsByMonitor: Record<string, RawCertEntry> = {}
    let maintenances: unknown[] = []

    const fail = (err: Error): void => {
      if (!settled) {
        settled = true
        reject(err)
      }
    }
    const finish = (): void => {
      if (settled) return
      settled = true
      resolve({ serverVersion, monitors: monitors ?? {}, beatsByMonitor, uptime24ByMonitor, certsByMonitor, maintenances })
    }

    /**
     * Settle condition: monitorList seen and uptime(24) received for every
     * monitor in it — uptime(24) is the per-monitor stat the server sends for
     * every monitor, so once all have arrived only the final monitor's
     * trailing uptime(720)/certInfo can still be in flight; the grace window
     * catches those. The cap timer bounds the whole burst regardless.
     */
    const maybeFinishSoon = (): void => {
      if (graceScheduled || !loginOk || monitors === null) return
      if (!Object.keys(monitors).every((id) => id in uptime24ByMonitor)) return
      graceScheduled = true
      later(finish, timings.settleGraceMs)
    }

    later(() => {
      if (!connectedOk) fail(new SystemError(`Uptime Kuma at ${cfg.url} is unreachable: socket connect timed out after ${timings.connectMs}ms`, 'kuma_unreachable'))
    }, timings.connectMs)

    socket.on('connect_error', (err) => {
      fail(new SystemError(`Uptime Kuma at ${cfg.url} is unreachable: ${boundedDetail(err)}`, 'kuma_unreachable'))
    })

    socket.on('info', (payload) => {
      const info = asRecord(payload)
      // Pre-auth the server hides the version (sendInfo(socket, true)); only
      // the post-login info event carries it.
      if (info && typeof info.version === 'string' && info.version) serverVersion = info.version
    })

    socket.on('monitorList', (payload) => {
      const map = asRecord(payload)
      if (!map) return
      monitors = {}
      for (const [id, monitor] of Object.entries(map)) {
        const record = asRecord(monitor)
        if (record) monitors[id] = record
      }
      maybeFinishSoon()
    })

    socket.on('heartbeatList', (monitorId, rows, overwrite) => {
      const key = String(monitorId)
      const list = Array.isArray(rows) ? (rows as RawHeartbeat[]) : []
      const existing = beatsByMonitor[key]
      // Mirrors the frontend merge (src/mixins/socket.js): first batch or
      // overwrite replaces; later batches carry older rows and are prepended.
      beatsByMonitor[key] = existing === undefined || overwrite === true ? list : [...list, ...existing]
    })

    socket.on('uptime', (monitorId, hours, ratio) => {
      if (hours !== 24 || typeof ratio !== 'number' || !Number.isFinite(ratio)) return
      uptime24ByMonitor[String(monitorId)] = ratio
      maybeFinishSoon()
    })

    socket.on('certInfo', (monitorId, infoJson) => {
      if (typeof infoJson !== 'string') return
      try {
        const parsed = asRecord(JSON.parse(infoJson))
        if (parsed) certsByMonitor[String(monitorId)] = parsed as RawCertEntry
      } catch {
        // One monitor's malformed TLS row must not sink the whole snapshot.
      }
    })

    socket.on('maintenanceList', (payload) => {
      const map = asRecord(payload)
      if (map) maintenances = Object.values(map)
    })

    socket.on('connect', () => {
      connectedOk = true
      later(() => {
        if (!loginAcked) fail(new SystemError(`Uptime Kuma at ${cfg.url}: no response to login after ${timings.loginMs}ms`, 'kuma_socket_failed'))
      }, timings.loginMs)

      socket.emit('login', { username: cfg.username, password: cfg.password, token: null }, (response) => {
        loginAcked = true
        const res = asRecord(response)
        if (!res) {
          return fail(new SystemError(`Uptime Kuma: malformed login response: ${boundedDetail(JSON.stringify(response))}`, 'kuma_socket_failed'))
        }
        if (res.tokenRequired === true) {
          return fail(
            new UserError(
              'this Uptime Kuma account has 2FA enabled, which the authenticated-socket transport does not support yet — use a non-2FA account or mode=public-status',
              'kuma_2fa_unsupported',
            ),
          )
        }
        if (res.ok !== true) {
          const msg = typeof res.msg === 'string' && res.msg ? boundedDetail(res.msg) : 'login rejected'
          return fail(new UserError(`Uptime Kuma rejected the configured credentials: ${msg}`, 'kuma_auth_failed'))
        }
        loginOk = true
        later(() => {
          // The cap is a bound, not an error: a slow burst resolves with what
          // arrived — but a burst with no monitorList at all is a broken session.
          if (monitors !== null) finish()
          else fail(new SystemError(`Uptime Kuma: no monitorList within ${timings.settleCapMs}ms of login`, 'kuma_socket_failed'))
        }, timings.settleCapMs)
        maybeFinishSoon()
      })
    })
  })

  return collected
    .then((snapshot) => {
      assertTestedVersion(snapshot.serverVersion, cfg)
      return snapshot
    })
    .finally(() => {
      socket.disconnect()
      for (const t of timers) clearTimeout(t)
    })
}

const AUTH_PAGE_TITLE = 'All monitors (authenticated)'
const AUTH_GROUP_NAME = 'all'

/**
 * The private monitor inventory as one pseudo status page, so the adapter's
 * normalizers and every existing command apply unchanged. `incident` is null
 * by construction — see the module comment.
 */
function synthesizeStatusPage(snapshot: KumaSnapshot): RawStatusPage {
  const monitorList = Object.entries(snapshot.monitors).map(([id, monitor]) => {
    const cert = snapshot.certsByMonitor[id]
    const certInfo = cert ? asRecord(cert.certInfo) : null
    return {
      id: typeof monitor.id === 'number' ? monitor.id : Number(id),
      name: monitor.name,
      type: monitor.type,
      url: monitor.url,
      certExpiryDaysRemaining: certInfo?.daysRemaining,
      validCert: typeof cert?.valid === 'boolean' ? cert.valid : undefined,
    }
  })
  return {
    config: { slug: null, title: AUTH_PAGE_TITLE, description: null, published: true, showCertificateExpiry: true },
    incident: null,
    publicGroupList: [{ id: null, name: AUTH_GROUP_NAME, monitorList }],
    maintenanceList: snapshot.maintenances,
  }
}

function synthesizeHeartbeats(snapshot: KumaSnapshot): RawHeartbeatPayload {
  const heartbeatList: Record<string, RawHeartbeat[]> = {}
  // Key every inventoried monitor, so beatless monitors still count — matches
  // the public payload, where the route emits a key per page monitor.
  for (const id of Object.keys(snapshot.monitors)) heartbeatList[id] = snapshot.beatsByMonitor[id] ?? []
  const uptimeList: Record<string, number> = {}
  for (const [id, ratio] of Object.entries(snapshot.uptime24ByMonitor)) uptimeList[`${id}_24`] = ratio
  return { heartbeatList, uptimeList }
}

export function createAuthenticatedSocketTransport(cfg: KumaConfig): KumaTransport {
  // One socket session per CLI invocation: every read shares the same
  // collected burst, and a failed collection stays failed — no retry storms.
  let snapshot: Promise<KumaSnapshot> | null = null
  const snap = (): Promise<KumaSnapshot> => (snapshot ??= collectKumaSnapshot(cfg))
  return {
    cachedTransport: false,
    privateData: {
      async monitorBeats(monitorId) {
        return (await snap()).beatsByMonitor[monitorId] ?? []
      },
      async certificates() {
        return (await snap()).certsByMonitor
      },
    },
    async getStatusPage() {
      return synthesizeStatusPage(await snap())
    },
    async getHeartbeats() {
      return synthesizeHeartbeats(await snap())
    },
  }
}
