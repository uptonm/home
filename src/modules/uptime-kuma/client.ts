import { request } from '../../core/http'
import type { ModuleConfig } from '../../core/types'
import { SystemError, UserError } from '../../core/errors'

export const KUMA_MODES = ['public-status', 'authenticated-socket'] as const
export type KumaMode = (typeof KUMA_MODES)[number]

export interface KumaConfig {
  url: string
  mode: KumaMode
  statusPageSlug: string
  insecureTLS?: boolean
}

export function readKumaConfig(cfg: ModuleConfig): KumaConfig {
  const url = String(cfg.url ?? '')
    .trim()
    .replace(/\/+$/, '')
  if (!url) {
    throw new UserError('uptime-kuma is not configured — run `home uptime-kuma configure`', 'kuma_not_configured')
  }
  const mode = String(cfg.mode ?? 'public-status').trim()
  if (!(KUMA_MODES as readonly string[]).includes(mode)) {
    throw new UserError(
      `uptime-kuma mode must be one of ${KUMA_MODES.join(', ')}, got "${mode}" — run \`home uptime-kuma configure\``,
      'kuma_not_configured',
    )
  }
  const statusPageSlug = String(cfg.statusPageSlug ?? '').trim()
  if (mode === 'public-status' && !statusPageSlug) {
    throw new UserError(
      'statusPageSlug is required when mode=public-status — run `home uptime-kuma configure`',
      'kuma_not_configured',
    )
  }
  return { url, mode: mode as KumaMode, statusPageSlug, insecureTLS: Boolean(cfg.insecureTLS) }
}

/**
 * Raw JSON from the public status routes (Uptime Kuma 1.23.x,
 * server/model/status_page.js `getStatusPageData`). Untyped beyond shape
 * hints — raw payloads never cross the command boundary; the adapter
 * normalizes them.
 */
export interface RawStatusPage {
  config?: Record<string, unknown>
  incident?: Record<string, unknown> | null
  publicGroupList?: unknown[]
  maintenanceList?: unknown[]
}

/** One public beat: server/model/heartbeat.js `toPublicJSON` — status int, UTC time string, ping ms. */
export interface RawHeartbeat {
  status?: number
  time?: string
  msg?: string
  ping?: number | null
}

/**
 * server/routers/status-page-router.js heartbeat route: last ≤50 beats per
 * monitor (ascending) keyed by monitor id, plus 24h uptime ratios keyed
 * `<monitorID>_24`.
 */
export interface RawHeartbeatPayload {
  heartbeatList?: Record<string, RawHeartbeat[]>
  uptimeList?: Record<string, number>
}

/**
 * Mode-agnostic data access. Commands and the adapter speak only to this
 * interface — route paths (public-status) and Socket.IO event names (the
 * future authenticated-socket transport) never leave their transport.
 */
export interface KumaTransport {
  /**
   * True when reads come from a server-side cache rather than live state.
   * The public status routes are apicache-cached (heartbeat 1 min, page
   * config 5 min) on top of the monitor poll interval, so data can trail
   * reality by ~5 minutes — commands surface this via `freshness`.
   */
  readonly cachedTransport: boolean
  /** Page config, groups with monitors, pinned incident, active maintenance windows. */
  getStatusPage(slug: string): Promise<RawStatusPage>
  /** Recent public beats + 24h uptime ratios for the page's monitors. */
  getHeartbeats(slug: string): Promise<RawHeartbeatPayload>
}

/** Rejects modes that have no transport yet; the seam for authenticated-socket. */
export function createKumaTransport(cfg: KumaConfig): KumaTransport {
  if (cfg.mode === 'authenticated-socket') {
    throw new UserError(
      'uptime-kuma mode "authenticated-socket" is not supported yet — it arrives in a later release; use mode=public-status',
      'kuma_mode_unsupported',
    )
  }
  return createPublicStatusTransport(cfg)
}

/** Public status-page transport: bounded unauthenticated GETs against the 1.23.x routes. */
export function createPublicStatusTransport(cfg: KumaConfig): KumaTransport {
  async function get(path: string): Promise<Response> {
    try {
      return await request(
        `${cfg.url}${path}`,
        { headers: { Accept: 'application/json' } },
        { insecureTLS: cfg.insecureTLS },
      )
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      throw new SystemError(`Uptime Kuma at ${cfg.url} is unreachable: ${message}`, 'kuma_unreachable')
    }
  }

  async function readJson(res: Response, path: string): Promise<unknown> {
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new SystemError(
        `Uptime Kuma: HTTP ${res.status} from ${path}${body ? `: ${body.slice(0, 200)}` : ''}`,
        'kuma_api_failed',
      )
    }
    try {
      return await res.json()
    } catch {
      throw new SystemError(`Uptime Kuma: non-JSON response from ${path}`, 'kuma_api_failed')
    }
  }

  /**
   * manifest.json is the only status-page route that fails fast on a bad slug
   * (404 {"status":"fail","msg":"Not Found"}). The config route
   * (/api/status-page/:slug) hits `return null` without sending a response in
   * 1.23.x (status-page-router.js), so a request for a missing page hangs
   * until the client times out — always probe here first.
   */
  async function assertPageExists(slug: string): Promise<void> {
    const path = `/api/status-page/${encodeURIComponent(slug)}/manifest.json`
    const res = await get(path)
    if (res.status === 404) {
      throw new UserError(
        `Uptime Kuma at ${cfg.url} is reachable but has no status page with slug "${slug}"`,
        'kuma_page_not_found',
      )
    }
    await readJson(res, path)
  }

  return {
    cachedTransport: true,
    async getStatusPage(slug) {
      await assertPageExists(slug)
      const path = `/api/status-page/${encodeURIComponent(slug)}`
      const json = await readJson(await get(path), path)
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new SystemError(`Uptime Kuma: unexpected status-page payload from ${path}`, 'kuma_api_failed')
      }
      return json as RawStatusPage
    },
    async getHeartbeats(slug) {
      const path = `/api/status-page/heartbeat/${encodeURIComponent(slug)}`
      const json = await readJson(await get(path), path)
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new SystemError(`Uptime Kuma: unexpected heartbeat payload from ${path}`, 'kuma_api_failed')
      }
      const payload = json as RawHeartbeatPayload
      // A bad slug is indistinguishable from a page with no public monitors
      // here — the route 200s with {"heartbeatList":{},"uptimeList":{}} either
      // way (slugToID finds no row, the monitor query returns nothing).
      // Disambiguate with the manifest probe before reporting "empty page".
      const empty =
        Object.keys(payload.heartbeatList ?? {}).length === 0 && Object.keys(payload.uptimeList ?? {}).length === 0
      if (empty) await assertPageExists(slug)
      return payload
    },
  }
}
