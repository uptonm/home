/**
 * Composition for `home overview ops`: correlate Vercel production
 * deployments, Uptime Kuma monitors, and Beszel systems into one operational
 * report. Correlation is driven entirely by the explicit mapping in
 * ~/.config/home/overview.json — never by name matching. Module probes are
 * injected so the aggregate is testable without clients;
 * src/commands/overview.ts wires the real ones.
 */
import { existsSync, readFileSync } from 'node:fs'
import { HomeError, NotConfiguredError, SystemError, UserError } from './errors'
import { paths } from './paths'
import type { RunResult } from './types'

// ── Config: ~/.config/home/overview.json ────────────────────────────────────

export interface OpsMappingGroup {
  /** Vercel project name — also the group's key for `--project`. */
  vercelProject: string
  /** Uptime Kuma monitor ids correlated with this project. */
  kumaMonitors: number[]
  /** Beszel system ids or exact names correlated with this project. */
  beszelSystems: string[]
}

export interface OpsConfig {
  projects: OpsMappingGroup[]
}

function invalid(detail: string): UserError {
  return new UserError(`${paths.overviewConfig} is invalid: ${detail}`, 'overview_config_invalid')
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

export function parseOpsConfig(raw: unknown): OpsConfig {
  const root = asRecord(raw)
  if (!root) throw invalid('expected a JSON object')
  if (root.ops === undefined) return { projects: [] }
  const ops = asRecord(root.ops)
  if (!ops) throw invalid('"ops" must be an object')
  if (ops.projects === undefined) return { projects: [] }
  if (!Array.isArray(ops.projects)) throw invalid('"ops.projects" must be an array')

  const projects: OpsMappingGroup[] = []
  for (const [i, entry] of ops.projects.entries()) {
    const at = `ops.projects[${i}]`
    const group = asRecord(entry)
    if (!group) throw invalid(`${at} must be an object`)
    const vercelProject = typeof group.vercelProject === 'string' ? group.vercelProject.trim() : ''
    if (!vercelProject) throw invalid(`${at}.vercelProject must be a non-empty string`)
    const kumaMonitors = group.kumaMonitors ?? []
    if (!Array.isArray(kumaMonitors) || kumaMonitors.some((m) => !Number.isInteger(m))) {
      throw invalid(`${at}.kumaMonitors must be an array of monitor ids (integers)`)
    }
    const beszelSystems = group.beszelSystems ?? []
    if (!Array.isArray(beszelSystems) || beszelSystems.some((s) => typeof s !== 'string' || s.trim() === '')) {
      throw invalid(`${at}.beszelSystems must be an array of system ids or names (non-empty strings)`)
    }
    projects.push({ vercelProject, kumaMonitors: kumaMonitors as number[], beszelSystems: beszelSystems as string[] })
  }
  return { projects }
}

export function loadOpsConfig(): OpsConfig {
  if (!existsSync(paths.overviewConfig)) return { projects: [] }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(paths.overviewConfig, 'utf8'))
  } catch (err) {
    throw new SystemError(`failed to parse ${paths.overviewConfig}: ${(err as Error).message}`, 'config_parse')
  }
  return parseOpsConfig(raw)
}

// ── Per-module section shapes (the probes' contract) ────────────────────────

export interface OpsDeployment {
  id: string
  state: string
  url: string | null
  createdAt: string | null
  commit: { sha: string; message: string | null; ref: string | null } | null
}

export interface OpsVercelProject {
  project: string
  /** Latest production deployment, or null when the project has none. */
  deployment: OpsDeployment | null
}

export interface OpsMonitor {
  id: string
  name: string
  status: string | null
  latencyMs: number | null
  lastBeatAt: string | null
  uptime24hPct: number | null
  certExpiryDays: number | null
  validCert: boolean | null
}

export interface OpsAlert {
  id: string
  type: string
  updatedAt: string | null
}

export interface OpsContainer {
  id: string
  name: string
  status: string | null
  health: string | null
  cpuPct: number | null
  memoryMb: number | null
}

export interface OpsSystem {
  id: string
  name: string
  status: string
  cpuPct: number | null
  memoryPct: number | null
  diskPct: number | null
}

export interface OpsBeszelData {
  systems: OpsSystem[]
  /** Currently-triggered alerts, joined onto systems by systemId. */
  alerts: (OpsAlert & { systemId: string })[]
  /** Containers fetched for the mapped systems only, keyed by system id. */
  containersBySystem: Record<string, OpsContainer[]>
}

export interface OpsProbes {
  vercel(projects: string[]): Promise<OpsVercelProject[]>
  kuma(): Promise<OpsMonitor[]>
  beszel(mappedSystems: string[]): Promise<OpsBeszelData>
}

// ── Overview result shape ────────────────────────────────────────────────────

export interface SectionNote {
  module: 'vercel' | 'uptime-kuma' | 'beszel'
  status: 'not_configured' | 'error'
  code?: string
  message?: string
}

export interface OpsGroupSystem extends OpsSystem {
  alerts: OpsAlert[]
  containers: OpsContainer[]
}

export interface OpsGroup {
  project: string
  deployment: OpsDeployment | null
  monitors: OpsMonitor[]
  systems: OpsGroupSystem[]
  /**
   * Mapping refs that matched no live monitor/system while that module WAS
   * reachable — a monitoring blind spot (typo'd name, renamed/un-published
   * service). Surfaced rather than silently dropped; a non-empty list degrades
   * the overall status.
   */
  unresolved: { monitors: string[]; systems: string[] }
}

export interface OpsOverview {
  generatedAt: string
  status: 'ok' | 'degraded'
  projects: OpsGroup[]
  /** Services present in their module but claimed by no mapping group. */
  unmapped: { monitors: OpsMonitor[]; systems: OpsGroupSystem[] }
  notes: SectionNote[]
}

/** Cap on each unmapped section so a large fleet can't flood the overview. */
export const UNMAPPED_MAX = 100

type ProbeOutcome<T> = { ok: true; data: T } | { ok: false; note: SectionNote }

async function probe<T>(module: SectionNote['module'], run: () => Promise<T>): Promise<ProbeOutcome<T>> {
  try {
    return { ok: true, data: await run() }
  } catch (err) {
    if (err instanceof NotConfiguredError) return { ok: false, note: { module, status: 'not_configured' } }
    return {
      ok: false,
      note: {
        module,
        status: 'error',
        code: err instanceof HomeError ? err.code : 'probe_failed',
        message: err instanceof Error ? err.message : String(err),
      },
    }
  }
}

export interface OpsOverviewOptions {
  /** Restrict to the mapping group whose vercelProject matches. */
  project?: string
}

export async function composeOpsOverview(
  config: OpsConfig,
  probes: OpsProbes,
  opts: OpsOverviewOptions = {},
): Promise<RunResult> {
  if (config.projects.length === 0) {
    return {
      ok: false,
      kind: 'config',
      message:
        `no ops mapping configured — create ${paths.overviewConfig} with ` +
        `{ "ops": { "projects": [{ "vercelProject": "…", "kumaMonitors": [], "beszelSystems": [] }] } }`,
      code: 'overview_failed',
    }
  }

  let selected = config.projects
  if (opts.project !== undefined) {
    selected = config.projects.filter((g) => g.vercelProject === opts.project)
    if (selected.length === 0) {
      const configured = config.projects.map((g) => g.vercelProject).join(', ')
      return {
        ok: false,
        kind: 'user',
        message: `no configured project "${opts.project}" — configured: ${configured}`,
        code: 'unknown_project',
      }
    }
  }

  const [vercel, kuma, beszel] = await Promise.all([
    probe('vercel', () => probes.vercel(selected.map((g) => g.vercelProject))),
    probe('uptime-kuma', () => probes.kuma()),
    probe('beszel', () => probes.beszel(selected.flatMap((g) => g.beszelSystems))),
  ])

  const monitors = kuma.ok ? kuma.data : []
  const monitorById = new Map(monitors.map((m) => [m.id, m] as const))

  const beszelData: OpsBeszelData = beszel.ok ? beszel.data : { systems: [], alerts: [], containersBySystem: {} }
  const alertsBySystem = new Map<string, OpsAlert[]>()
  for (const { systemId, ...alert } of beszelData.alerts) {
    const list = alertsBySystem.get(systemId) ?? []
    list.push(alert)
    alertsBySystem.set(systemId, list)
  }
  const systemByRef = new Map<string, OpsSystem>()
  for (const s of beszelData.systems) {
    systemByRef.set(s.id, s)
    systemByRef.set(s.name.toLowerCase(), s)
  }
  // Mirror beszel's own resolveExact: exact id first, then case-insensitive
  // name — so a mapping ref of "Boris" finds the system named "boris", exactly
  // as `home beszel systems get Boris` does.
  const resolveSystem = (ref: string): OpsSystem | undefined =>
    systemByRef.get(ref) ?? systemByRef.get(ref.trim().toLowerCase())
  const toGroupSystem = (s: OpsSystem): OpsGroupSystem => ({
    ...s,
    alerts: alertsBySystem.get(s.id) ?? [],
    containers: beszelData.containersBySystem[s.id] ?? [],
  })

  const groups: OpsGroup[] = selected.map((g) => {
    const deployment = vercel.ok ? (vercel.data.find((p) => p.project === g.vercelProject)?.deployment ?? null) : null
    const groupMonitors: OpsMonitor[] = []
    const unresolvedMonitors: string[] = []
    for (const id of g.kumaMonitors) {
      const m = monitorById.get(String(id))
      if (m) groupMonitors.push(m)
      // Only a REACHABLE board makes a missing id a real dangling ref; a down
      // module is already reported via its section note.
      else if (kuma.ok) unresolvedMonitors.push(String(id))
    }
    const seen = new Set<string>()
    const systems: OpsGroupSystem[] = []
    const unresolvedSystems: string[] = []
    for (const ref of g.beszelSystems) {
      const s = resolveSystem(ref)
      if (s) {
        if (!seen.has(s.id)) {
          seen.add(s.id)
          systems.push(toGroupSystem(s))
        }
      } else if (beszel.ok) {
        unresolvedSystems.push(ref)
      }
    }
    return {
      project: g.vercelProject,
      deployment,
      monitors: groupMonitors,
      systems,
      unresolved: { monitors: unresolvedMonitors, systems: unresolvedSystems },
    }
  })

  // Unmapped is judged against the FULL config, not the --project selection,
  // so a filtered view never misfiles another group's services as unmapped.
  const claimedMonitorIds = new Set(config.projects.flatMap((g) => g.kumaMonitors.map(String)))
  const claimedSystemIds = new Set<string>()
  for (const g of config.projects) {
    for (const ref of g.beszelSystems) {
      const s = resolveSystem(ref)
      if (s) claimedSystemIds.add(s.id)
    }
  }
  const unmapped: OpsOverview['unmapped'] = {
    monitors: monitors.filter((m) => !claimedMonitorIds.has(m.id)).slice(0, UNMAPPED_MAX),
    systems: beszelData.systems
      .filter((s) => !claimedSystemIds.has(s.id))
      .slice(0, UNMAPPED_MAX)
      .map(toGroupSystem),
  }

  const notes = [vercel, kuma, beszel].flatMap((r) => (r.ok ? [] : [r.note]))
  // A dangling mapping ref is a monitoring blind spot — a whole host/endpoint
  // missing while the report otherwise looks healthy — so it degrades status.
  const hasUnresolved = groups.some((g) => g.unresolved.monitors.length > 0 || g.unresolved.systems.length > 0)
  const overview: OpsOverview = {
    generatedAt: new Date().toISOString(),
    status: notes.length > 0 || hasUnresolved ? 'degraded' : 'ok',
    projects: groups,
    unmapped,
    notes,
  }
  return { ok: true, data: overview }
}
