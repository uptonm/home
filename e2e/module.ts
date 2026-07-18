import type { ArgSpec, CommandSpec } from '../src/core/types'
import { modules } from '../src/registry'
import { commandKey, runCli, runStatus } from './cli'
import { Unresolved, argProviders } from './args'
import { runScenario, type Scenario, type ScenarioResult } from './scenario'
import { sonosScenarios } from './scenarios/sonos'
import type { LiveState } from './live'

type Module = (typeof modules)[number]

/** Every write scenario the harness knows, across all modules. */
export const scenarios: readonly Scenario[] = [...sonosScenarios]

export interface ReadResult {
  key: string
  outcome: 'pass' | 'fail' | 'unresolved'
  detail?: string
}

export interface ModuleResult {
  module: string
  skipped: { reason: string } | null
  reads: ReadResult[]
  scenarios: ScenarioResult[]
}

function buildArgv(spec: CommandSpec, values: Record<string, string>): string[] {
  const argv: string[] = []
  for (const a of spec.args as ArgSpec[]) {
    const v = values[a.name]
    if (v === undefined) continue
    if (a.kind === 'positional') argv.push(v)
    else if (a.kind === 'boolean') {
      if (v === 'true') argv.push(`--${a.name}`)
    } else argv.push(`--${a.name}`, v)
  }
  return argv
}

async function autoRead(module: string, cmd: CommandSpec): Promise<ReadResult> {
  const key = commandKey(module, cmd.path)
  let values: Record<string, string> = {}
  const provider = argProviders[key]
  const needsArgs = cmd.args.some((a) => a.required)
  if (provider) {
    try {
      values = await provider()
    } catch (err) {
      if (err instanceof Unresolved) return { key, outcome: 'unresolved', detail: err.message }
      throw err
    }
  } else if (needsArgs) {
    return { key, outcome: 'unresolved', detail: 'required args, no provider' }
  }
  const res = await runCli(module, cmd.path, buildArgv(cmd, values))
  if (res.exitCode !== 0) {
    return {
      key,
      outcome: 'fail',
      detail: `exit ${res.exitCode}: ${res.stderr.trim() || res.stdout.trim()}`.slice(0, 300),
    }
  }
  // Exit 0 is not enough: every command runs with --json, so non-JSON stdout
  // means the read regressed even though the process claims success.
  if (res.json === null) {
    return { key, outcome: 'fail', detail: 'exit 0 but stdout was not valid JSON' }
  }
  return { key, outcome: 'pass' }
}

/**
 * Run one module end to end: preflight, then its reads (serial), then its
 * scenarios (serial). Emits progress by mutating `live`; returns structured
 * results. Never writes to the console, so many modules can run at once.
 */
export async function runModule(
  m: Module,
  live: LiveState,
  opts: { readsOnly: boolean },
): Promise<ModuleResult> {
  live.phase = 'preflight'
  const status = await runStatus(m.name)
  if (status.exitCode === 3) {
    live.phase = 'skipped'
    live.skipReason = 'not configured'
    return { module: m.name, skipped: { reason: 'not configured' }, reads: [], scenarios: [] }
  }
  if (status.exitCode !== 0) {
    // 143 = SIGTERM from our own timeout kill.
    const reason = status.exitCode === 143 ? 'status timed out' : `status exited ${status.exitCode}`
    live.phase = 'skipped'
    live.skipReason = reason
    return { module: m.name, skipped: { reason }, reads: [], scenarios: [] }
  }

  const readCmds = m.commands.filter((c) => c.effect === 'read')
  live.readsTotal = readCmds.length
  live.phase = 'reads'
  const reads: ReadResult[] = []
  for (const c of readCmds) {
    reads.push(await autoRead(m.name, c))
    live.readsDone++
  }

  const moduleScenarios = opts.readsOnly ? [] : scenarios.filter((s) => s.module === m.name)
  const scenarioResults: ScenarioResult[] = []
  if (moduleScenarios.length) {
    live.phase = 'scenarios'
    for (const s of moduleScenarios) {
      live.scenario = s.name
      scenarioResults.push(await runScenario(s))
    }
    live.scenario = null
  }

  const failed =
    reads.some((r) => r.outcome === 'fail') || scenarioResults.some((r) => r.outcome === 'fail')
  live.phase = 'done'
  live.outcome = failed ? 'fail' : 'pass'
  return { module: m.name, skipped: null, reads, scenarios: scenarioResults }
}
