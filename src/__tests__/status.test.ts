import { describe, expect, test } from 'bun:test'
import { collectModuleStatuses, type ModuleConfigResolver } from '../core/status'
import type { ModuleManifest } from '../core/types'

function manifest(
  name: string,
  status: ModuleManifest['status'],
  opts: { requiresConfig?: boolean; configured?: boolean } = {},
): { manifest: ModuleManifest; configured: boolean } {
  return {
    configured: opts.configured ?? true,
    manifest: {
      name,
      description: `${name} test module`,
      whenToUse: 'test only',
      configSchema: [{ key: 'token', label: 'Token', kind: 'secret', required: true }],
      ...(opts.requiresConfig === undefined ? {} : { requiresConfig: opts.requiresConfig }),
      commands: [],
      status,
    },
  }
}

describe('root status collector', () => {
  test('preserves module data and summarizes mixed results', async () => {
    const fixtures = [
      manifest('healthy', async () => ({ ok: true, data: { latencyMs: 12 } })),
      manifest('broken', async () => ({ ok: false, kind: 'system', message: 'offline', code: 'offline' })),
      manifest('missing', async () => ({ ok: true }), { configured: false }),
    ]
    const configured = new Map(fixtures.map((fixture) => [fixture.manifest.name, fixture.configured]))
    const resolve: ModuleConfigResolver = (item) => configured.get(item.name) ? { token: 'test' } : null

    const report = await collectModuleStatuses(fixtures.map((fixture) => fixture.manifest), resolve)

    expect(report.status).toBe('degraded')
    expect(report.summary).toEqual({ ok: 1, error: 1, notConfigured: 1 })
    expect(report.modules[0]).toEqual({
      module: 'healthy',
      configured: true,
      status: 'ok',
      data: { latencyMs: 12 },
    })
    expect(report.modules[1]).toMatchObject({ status: 'error', message: 'offline', code: 'offline' })
    expect(report.modules[2]).toEqual({ module: 'missing', configured: false, status: 'not_configured' })
  })

  test('runs optional-config modules with an empty config', async () => {
    let received: unknown
    const optional = manifest('optional', async (cfg) => {
      received = cfg
      return { ok: true, data: { ready: true } }
    }, { requiresConfig: false, configured: false })

    const report = await collectModuleStatuses([optional.manifest], () => null)

    expect(received).toEqual({})
    expect(report.status).toBe('ok')
    expect(report.modules[0]).toMatchObject({ configured: false, status: 'ok' })
  })

  test('contains thrown status and config errors without rejecting the aggregate', async () => {
    const thrown = manifest('thrown', async () => { throw new Error('probe exploded') })
    const configFailure = manifest('config-failure', async () => ({ ok: true }))
    const resolve: ModuleConfigResolver = (item) => {
      if (item.name === 'config-failure') throw new Error('bad config')
      return { token: 'test' }
    }

    const report = await collectModuleStatuses([thrown.manifest, configFailure.manifest], resolve)

    expect(report.summary.error).toBe(2)
    expect(report.modules[0]).toMatchObject({ code: 'status_failed', message: 'probe exploded' })
    expect(report.modules[1]).toMatchObject({ code: 'config_failed', message: 'bad config' })
  })
})
