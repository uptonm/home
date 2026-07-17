import type { ModuleConfig, ModuleManifest } from './types'

export type ModuleStatusState = 'ok' | 'error' | 'not_configured'
export type RootStatusState = 'ok' | 'degraded' | 'not_configured'

export interface ModuleStatusReport {
  module: string
  configured: boolean
  status: ModuleStatusState
  data?: unknown
  message?: string
  code?: string
}

export interface RootStatusReport {
  status: RootStatusState
  summary: {
    ok: number
    error: number
    notConfigured: number
  }
  modules: ModuleStatusReport[]
}

export type ModuleConfigResolver = (manifest: ModuleManifest) => ModuleConfig | null

async function collectOneStatus(
  manifest: ModuleManifest,
  resolveConfig: ModuleConfigResolver,
): Promise<ModuleStatusReport> {
  const requiresConfig = manifest.requiresConfig ?? manifest.configSchema.length > 0
  let config: ModuleConfig | null

  try {
    config = resolveConfig(manifest)
  } catch (err) {
    return {
      module: manifest.name,
      configured: false,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      code: 'config_failed',
    }
  }

  if (!config && requiresConfig) {
    return { module: manifest.name, configured: false, status: 'not_configured' }
  }

  try {
    const result = await manifest.status(config ?? {})
    if (result.ok) {
      return {
        module: manifest.name,
        configured: config !== null,
        status: 'ok',
        ...(result.data === undefined ? {} : { data: result.data }),
      }
    }
    return {
      module: manifest.name,
      configured: config !== null,
      status: 'error',
      message: result.message,
      ...(result.code === undefined ? {} : { code: result.code }),
    }
  } catch (err) {
    return {
      module: manifest.name,
      configured: config !== null,
      status: 'error',
      message: err instanceof Error ? err.message : String(err),
      code: 'status_failed',
    }
  }
}

/** Run every module readiness probe concurrently and retain its structured data. */
export async function collectModuleStatuses(
  manifests: ModuleManifest[],
  resolveConfig: ModuleConfigResolver,
): Promise<RootStatusReport> {
  const reports = await Promise.all(manifests.map((manifest) => collectOneStatus(manifest, resolveConfig)))
  const summary = {
    ok: reports.filter((report) => report.status === 'ok').length,
    error: reports.filter((report) => report.status === 'error').length,
    notConfigured: reports.filter((report) => report.status === 'not_configured').length,
  }
  const status: RootStatusState = summary.error > 0
    ? 'degraded'
    : summary.ok > 0
      ? 'ok'
      : 'not_configured'

  return { status, summary, modules: reports }
}
