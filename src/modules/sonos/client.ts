import { SonosManager, type SonosDevice } from '@svrooij/sonos'
import type { ModuleConfig, RunContext, RunResult } from '../../core/types'

export interface SonosConfig {
  discoveryTimeoutSec: number
}

const DEFAULT_DISCOVERY_TIMEOUT_SEC = 3

export function readSonosConfig(cfg: ModuleConfig): SonosConfig {
  const raw = Number(cfg.discoveryTimeoutSec)
  const timeout = Number.isFinite(raw) && raw > 0 ? Math.min(raw, 30) : DEFAULT_DISCOVERY_TIMEOUT_SEC
  return { discoveryTimeoutSec: timeout }
}

export async function discover(cfg: SonosConfig): Promise<SonosManager> {
  const mgr = new SonosManager()
  const ok = await mgr.InitializeWithDiscovery(cfg.discoveryTimeoutSec)
  if (!ok) {
    mgr.CancelSubscription()
    throw new Error('no Sonos devices found on the network (SSDP multicast)')
  }
  return mgr
}

export interface PlayerSummary {
  name: string
  uuid: string
  host: string
  group: string | undefined
  isCoordinator: boolean
}

export function summarizePlayer(d: SonosDevice): PlayerSummary {
  return {
    name: d.Name,
    uuid: d.Uuid,
    host: d.Host,
    group: d.GroupName,
    isCoordinator: d.Coordinator?.Uuid === d.Uuid,
  }
}

export interface GroupSummary {
  name: string
  coordinator: string
  members: string[]
}

export function summarizeGroups(devices: SonosDevice[]): GroupSummary[] {
  const groups = new Map<string, { coordinator: string; members: string[] }>()
  for (const d of devices) {
    const key = d.GroupName ?? d.Name
    if (!groups.has(key)) groups.set(key, { coordinator: '', members: [] })
    const g = groups.get(key)!
    g.members.push(d.Name)
    if (d.Coordinator?.Uuid === d.Uuid) g.coordinator = d.Name
  }
  return Array.from(groups.entries()).map(([name, g]) => ({
    name,
    coordinator: g.coordinator || g.members[0]!,
    members: g.members.sort(),
  }))
}

/**
 * Resolve a user-supplied room reference (case-insensitive, exact or substring
 * over device Name) to one device. Ambiguous matches return null candidates.
 */
export type ResolveRoom =
  | { kind: 'ok'; device: SonosDevice }
  | { kind: 'not_found' }
  | { kind: 'ambiguous'; candidates: string[] }

export function resolveRoom(devices: SonosDevice[], ref: string): ResolveRoom {
  const lower = ref.toLowerCase()
  const exact = devices.filter((d) => d.Name.toLowerCase() === lower)
  if (exact.length === 1) return { kind: 'ok', device: exact[0]! }
  const sub = devices.filter((d) => d.Name.toLowerCase().includes(lower))
  if (sub.length === 1) return { kind: 'ok', device: sub[0]! }
  if (sub.length > 1) return { kind: 'ambiguous', candidates: sub.map((d) => d.Name).sort() }
  return { kind: 'not_found' }
}

/**
 * Pick a coordinator from a room reference. If `ref` is omitted, returns the
 * first coordinator found — useful for whole-house commands when there's only
 * one group.
 */
export function pickCoordinator(devices: SonosDevice[], ref?: string): ResolveRoom {
  if (!ref) {
    const coords = devices.filter((d) => d.Coordinator?.Uuid === d.Uuid)
    if (coords.length === 0) return { kind: 'not_found' }
    if (coords.length === 1) return { kind: 'ok', device: coords[0]! }
    return { kind: 'ambiguous', candidates: coords.map((d) => d.Name).sort() }
  }
  const r = resolveRoom(devices, ref)
  if (r.kind !== 'ok') return r
  return { kind: 'ok', device: r.device.Coordinator ?? r.device }
}

/**
 * Translate a user-supplied URL into a URI Sonos's SOAP API accepts.
 *
 * Plain `http://` works for files we host ourselves (`notify --file`,
 * `enqueueAndPlay` with known-finite Content-Length). For arbitrary remote
 * URLs — anything we didn't generate — we can't introspect whether the
 * endpoint is a discrete file or an indefinite stream, so we route through
 * `x-rincon-mp3radio://` which Sonos treats as a stream uniformly. That's
 * the same shape that `home sonos play-uri` has used since SomaFM testing;
 * `home sonos notify --url` now uses the same translation so the two
 * commands behave identically for the same input URL.
 */
export function toSonosTrackUri(rawUrl: string): string {
  if (/^https?:\/\//i.test(rawUrl)) {
    return rawUrl.replace(/^https?:\/\//i, 'x-rincon-mp3radio://')
  }
  return rawUrl
}

export interface EnqueueResult {
  firstTrackEnqueued: number
  numTracksAdded: number
  newQueueLength: number
}

/**
 * Add a URI to the device's queue and start playing it. Handles the
 * "AddURIToQueue → Seek-to-the-added-track → Play" sequence the SOAP API
 * needs for any newly-added item to actually become the current track,
 * including the `Number(result.FirstTrackNumberEnqueued)` finiteness check
 * that several Sonos firmwares fail silently if you skip.
 *
 * Shared between `home sonos play-uri` (replace + play) and
 * `home sonos queue add --play` (append + play) — both routes need exactly
 * this 3-step recipe and used to inline it independently.
 */
export async function enqueueAndPlay(
  device: SonosDevice,
  transportUri: string,
  metadata: string,
  opts: { enqueueAsNext?: boolean } = {},
): Promise<EnqueueResult> {
  const result = await device.AVTransportService.AddURIToQueue({
    InstanceID: 0,
    EnqueuedURI: transportUri,
    EnqueuedURIMetaData: metadata,
    DesiredFirstTrackNumberEnqueued: 0,
    EnqueueAsNext: opts.enqueueAsNext ?? true,
  })
  const trackNr = Number(result.FirstTrackNumberEnqueued)
  if (Number.isFinite(trackNr) && trackNr > 0) {
    await device.AVTransportService.Seek({ InstanceID: 0, Unit: 'TRACK_NR', Target: String(trackNr) })
  }
  await device.Play()
  return {
    firstTrackEnqueued: result.FirstTrackNumberEnqueued,
    numTracksAdded: result.NumTracksAdded,
    newQueueLength: result.NewQueueLength,
  }
}

export interface WithRoomOptions {
  /**
   * `'device'` returns the literal speaker matched by the room reference —
   * use this for per-device operations like volume / mute / notify.
   *
   * `'coordinator'` returns the group coordinator (for grouped speakers, the
   * one that controls playback). With no room reference, falls back to the
   * household's single coordinator if there's exactly one; otherwise reports
   * ambiguity. Use this for queue / playback / play-uri commands.
   */
  pick: 'device' | 'coordinator'
  /** Positional arg name holding the room reference. Defaults to `'room'`. */
  roomArg?: string
  /** When true, omitting the room reference is a user error. Defaults to false (the helper picks the only coordinator). */
  required?: boolean
}

/**
 * Discover the network, resolve the user-supplied room reference to a single
 * device, and invoke `fn(device)`. Returns the resulting `RunResult`, or a
 * structured `'not_found'` / `'ambiguous'` / `'missing_arg'` user error if
 * the room can't be resolved unambiguously.
 *
 * Shared by every per-room sonos command — extracted so error phrasings stay
 * identical across commands and so future room-resolution behavior changes
 * happen in one place.
 */
export async function withRoom(
  ctx: RunContext,
  opts: WithRoomOptions,
  fn: (device: SonosDevice) => Promise<RunResult>,
): Promise<RunResult> {
  const argName = opts.roomArg ?? 'room'
  const ref = ctx.args[argName] ? String(ctx.args[argName]) : undefined
  if (opts.required && !ref) {
    return { ok: false, kind: 'user', message: `${argName} is required`, code: 'missing_arg' }
  }

  const mgr = await discover(readSonosConfig(ctx.config))
  const resolved = opts.pick === 'coordinator'
    ? pickCoordinator(mgr.Devices, ref)
    : ref ? resolveRoom(mgr.Devices, ref) : { kind: 'not_found' as const }

  if (resolved.kind === 'not_found') {
    return {
      ok: false,
      kind: 'user',
      message: ref ? `no room matching "${ref}"` : 'no room specified and no single coordinator to fall back to',
      code: 'not_found',
    }
  }
  if (resolved.kind === 'ambiguous') {
    return {
      ok: false,
      kind: 'user',
      message: `room is ambiguous — candidates: ${resolved.candidates.join(', ')}`,
      code: 'ambiguous',
    }
  }
  return fn(resolved.device)
}
