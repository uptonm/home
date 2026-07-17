import { describe, expect, test } from 'bun:test'
import { NotConfiguredError, SystemError } from '../core/errors'
import {
  composeOpsOverview,
  parseOpsConfig,
  UNMAPPED_MAX,
  type OpsBeszelData,
  type OpsConfig,
  type OpsMonitor,
  type OpsOverview,
  type OpsProbes,
  type OpsVercelProject,
} from '../core/overview'

function monitor(id: number, name: string, overrides: Partial<OpsMonitor> = {}): OpsMonitor {
  return {
    id: String(id),
    name,
    status: 'up',
    latencyMs: 42,
    lastBeatAt: '2026-07-17T00:00:00.000Z',
    uptime24hPct: 100,
    certExpiryDays: 30,
    validCert: true,
    ...overrides,
  }
}

function deploymentFor(project: string): OpsVercelProject {
  return {
    project,
    deployment: {
      id: `dpl_${project}`,
      state: 'ready',
      url: `${project}.vercel.app`,
      createdAt: '2026-07-16T12:00:00.000Z',
      commit: { sha: 'abc123', message: 'ship it', ref: 'main' },
    },
  }
}

const borisData: OpsBeszelData = {
  systems: [
    { id: 'sys_boris', name: 'boris', status: 'up', cpuPct: 12, memoryPct: 40, diskPct: 55 },
    { id: 'sys_nas', name: 'nas', status: 'up', cpuPct: 2, memoryPct: 10, diskPct: 80 },
  ],
  alerts: [{ id: 'alr_1', type: 'Disk', systemId: 'sys_boris', updatedAt: '2026-07-17T01:00:00.000Z' }],
  containersBySystem: { sys_boris: [{ id: 'ctr_1', name: 'caddy', status: 'running', health: 'healthy', cpuPct: 1, memoryMb: 64 }] },
}

const config: OpsConfig = {
  projects: [{ vercelProject: 'uptonm-dev', kumaMonitors: [1, 2], beszelSystems: ['boris'] }],
}

function probesReturning(overrides: Partial<OpsProbes> = {}): OpsProbes {
  return {
    vercel: async (projects) => projects.map(deploymentFor),
    kuma: async () => [monitor(1, 'site'), monitor(2, 'api'), monitor(9, 'unrelated')],
    beszel: async () => borisData,
    ...overrides,
  }
}

function dataOf(result: Awaited<ReturnType<typeof composeOpsOverview>>): OpsOverview {
  if (!result.ok) throw new Error(`expected ok result, got ${JSON.stringify(result)}`)
  return result.data as OpsOverview
}

describe('overview ops composition', () => {
  test('groups mapped services under their configured project', async () => {
    const overview = dataOf(await composeOpsOverview(config, probesReturning()))

    expect(overview.status).toBe('ok')
    expect(overview.notes).toEqual([])
    expect(overview.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/)
    expect(overview.projects).toHaveLength(1)

    const group = overview.projects[0]!
    expect(group.project).toBe('uptonm-dev')
    expect(group.deployment).toMatchObject({ id: 'dpl_uptonm-dev', state: 'ready', commit: { sha: 'abc123' } })
    expect(group.monitors.map((m) => m.id)).toEqual(['1', '2'])
    expect(group.systems).toHaveLength(1)
    expect(group.systems[0]).toMatchObject({
      id: 'sys_boris',
      name: 'boris',
      alerts: [{ id: 'alr_1', type: 'Disk' }],
      containers: [{ id: 'ctr_1', name: 'caddy' }],
    })
  })

  test('unmapped monitors and systems land in the flat sections', async () => {
    const overview = dataOf(await composeOpsOverview(config, probesReturning()))

    expect(overview.unmapped.monitors.map((m) => m.id)).toEqual(['9'])
    expect(overview.unmapped.systems.map((s) => s.name)).toEqual(['nas'])
    // unmapped systems still carry their joined alerts/containers shape
    expect(overview.unmapped.systems[0]).toMatchObject({ alerts: [], containers: [] })
  })

  test('a beszel ref resolves case-insensitively, matching `beszel systems get`', async () => {
    const upper: OpsConfig = {
      projects: [{ vercelProject: 'uptonm-dev', kumaMonitors: [1], beszelSystems: ['Boris'] }],
    }
    const overview = dataOf(await composeOpsOverview(upper, probesReturning()))
    const group = overview.projects[0]!
    expect(group.systems.map((s) => s.id)).toEqual(['sys_boris'])
    expect(group.unresolved.systems).toEqual([])
    expect(overview.status).toBe('ok')
  })

  test('dangling mapping refs are surfaced and degrade status, not silently dropped', async () => {
    const bad: OpsConfig = {
      projects: [{ vercelProject: 'uptonm-dev', kumaMonitors: [1, 404], beszelSystems: ['boris', 'ghost'] }],
    }
    const overview = dataOf(await composeOpsOverview(bad, probesReturning()))
    const group = overview.projects[0]!
    expect(group.monitors.map((m) => m.id)).toEqual(['1'])
    expect(group.systems.map((s) => s.id)).toEqual(['sys_boris'])
    expect(group.unresolved.monitors).toEqual(['404'])
    expect(group.unresolved.systems).toEqual(['ghost'])
    expect(overview.status).toBe('degraded')
  })

  test('a down module does not flood unresolved with its refs — its section note covers it', async () => {
    const probes = probesReturning({
      beszel: async () => {
        throw new SystemError('hub unreachable', 'beszel_http_502')
      },
    })
    const overview = dataOf(await composeOpsOverview(config, probes))
    const group = overview.projects[0]!
    expect(group.systems).toEqual([])
    expect(group.unresolved.systems).toEqual([])
    expect(overview.status).toBe('degraded')
  })

  test('a failing module degrades its section and leaves the rest intact', async () => {
    const probes = probesReturning({
      beszel: async () => {
        throw new SystemError('hub unreachable', 'beszel_http_502')
      },
    })
    const overview = dataOf(await composeOpsOverview(config, probes))

    expect(overview.status).toBe('degraded')
    expect(overview.notes).toEqual([
      { module: 'beszel', status: 'error', code: 'beszel_http_502', message: 'hub unreachable' },
    ])
    expect(overview.projects[0]!.deployment).not.toBeNull()
    expect(overview.projects[0]!.monitors).toHaveLength(2)
    expect(overview.projects[0]!.systems).toEqual([])
    expect(overview.unmapped.systems).toEqual([])
  })

  test('a not-configured module contributes a not_configured note without a message', async () => {
    const probes = probesReturning({
      kuma: async () => {
        throw new NotConfiguredError('uptime-kuma')
      },
    })
    const overview = dataOf(await composeOpsOverview(config, probes))

    expect(overview.status).toBe('degraded')
    expect(overview.notes).toEqual([{ module: 'uptime-kuma', status: 'not_configured' }])
    expect(overview.projects[0]!.monitors).toEqual([])
  })

  test('--project filters to one mapping group and scopes the vercel fetch', async () => {
    const twoGroups: OpsConfig = {
      projects: [
        { vercelProject: 'uptonm-dev', kumaMonitors: [1], beszelSystems: ['boris'] },
        { vercelProject: 'other-app', kumaMonitors: [2], beszelSystems: ['nas'] },
      ],
    }
    let requestedProjects: string[] = []
    const probes = probesReturning({
      vercel: async (projects) => {
        requestedProjects = projects
        return projects.map(deploymentFor)
      },
    })
    const overview = dataOf(await composeOpsOverview(twoGroups, probes, { project: 'other-app' }))

    expect(requestedProjects).toEqual(['other-app'])
    expect(overview.projects.map((g) => g.project)).toEqual(['other-app'])
    // monitor 1 and boris belong to the other group — they are mapped, not unmapped
    expect(overview.unmapped.monitors.map((m) => m.id)).toEqual(['9'])
    expect(overview.unmapped.systems).toEqual([])
  })

  test('--project with an unknown name errors and lists the configured projects', async () => {
    const result = await composeOpsOverview(config, probesReturning(), { project: 'nope' })

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('user')
    expect(result.code).toBe('unknown_project')
    expect(result.message).toContain('"nope"')
    expect(result.message).toContain('uptonm-dev')
  })

  test('probes all run, concurrently', async () => {
    const calls = { vercel: 0, kuma: 0, beszel: 0 }
    let started = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    // Each probe blocks until all three have started — sequential fan-out deadlocks.
    const arrive = async (): Promise<void> => {
      started += 1
      if (started === 3) release()
      await gate
    }
    const probes: OpsProbes = {
      vercel: async (projects) => {
        calls.vercel += 1
        await arrive()
        return projects.map(deploymentFor)
      },
      kuma: async () => {
        calls.kuma += 1
        await arrive()
        return []
      },
      beszel: async () => {
        calls.beszel += 1
        await arrive()
        throw new SystemError('boom', 'beszel_http_500')
      },
    }

    const overview = dataOf(await composeOpsOverview(config, probes))

    expect(calls).toEqual({ vercel: 1, kuma: 1, beszel: 1 })
    expect(overview.status).toBe('degraded')
  })

  test('unmapped sections are bounded', async () => {
    const many = Array.from({ length: UNMAPPED_MAX + 50 }, (_, i) => monitor(1000 + i, `m${i}`))
    const overview = dataOf(await composeOpsOverview(config, probesReturning({ kuma: async () => many })))

    expect(overview.unmapped.monitors).toHaveLength(UNMAPPED_MAX)
  })

  test('empty mapping fails with overview_failed naming the config file', async () => {
    const result = await composeOpsOverview({ projects: [] }, probesReturning())

    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('unreachable')
    expect(result.kind).toBe('config')
    expect(result.code).toBe('overview_failed')
    expect(result.message).toContain('overview.json')
    expect(result.message).toContain('"vercelProject"')
  })
})

describe('overview ops config parsing', () => {
  test('parses the documented shape and defaults optional arrays', () => {
    const parsed = parseOpsConfig({
      ops: { projects: [{ vercelProject: 'uptonm-dev', kumaMonitors: [1, 2], beszelSystems: ['boris'] }, { vercelProject: 'bare' }] },
    })
    expect(parsed.projects).toEqual([
      { vercelProject: 'uptonm-dev', kumaMonitors: [1, 2], beszelSystems: ['boris'] },
      { vercelProject: 'bare', kumaMonitors: [], beszelSystems: [] },
    ])
  })

  test('missing ops key means an empty mapping', () => {
    expect(parseOpsConfig({})).toEqual({ projects: [] })
  })

  test('rejects malformed entries with the offending path', () => {
    expect(() => parseOpsConfig({ ops: { projects: [{ kumaMonitors: [1] }] } })).toThrow('ops.projects[0].vercelProject')
    expect(() => parseOpsConfig({ ops: { projects: [{ vercelProject: 'x', kumaMonitors: ['1'] }] } })).toThrow(
      'kumaMonitors',
    )
    expect(() => parseOpsConfig({ ops: { projects: [{ vercelProject: 'x', beszelSystems: [''] }] } })).toThrow(
      'beszelSystems',
    )
  })
})
