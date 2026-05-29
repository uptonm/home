import { SonosManager, type SonosDevice } from '@svrooij/sonos'
import type { ModuleConfig } from '../../core/types'

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
