import { commandKey, runCli, type CliResult } from './cli'
import { fixtures } from './fixtures'

export interface ScenarioCtx {
  cli: typeof runCli
  /**
   * Like `cli`, but throws on a nonzero exit. Restores MUST use this:
   * `runCli` resolves normally for command failures (the failure lives in
   * `exitCode`), so a plain `cli()` restore that fails would leave the house
   * changed while the scenario reports PASS.
   */
  cliOk(module: string, path: string[], args?: string[], opts?: { timeoutMs?: number }): Promise<CliResult>
  fixtures: typeof fixtures
  check(cond: boolean, msg: string): void
  /** Push a restore step; restores run LIFO even when the scenario fails. */
  defer(fn: () => Promise<void>): void
}

export interface Scenario {
  name: string
  module: string
  run(ctx: ScenarioCtx): Promise<void>
}

export interface ScenarioResult {
  name: string
  module: string
  outcome: 'pass' | 'fail'
  detail?: string
}

export async function runScenario(s: Scenario): Promise<ScenarioResult> {
  const restores: Array<() => Promise<void>> = []
  const ctx: ScenarioCtx = {
    cli: runCli,
    async cliOk(module, path, args = [], opts = {}) {
      const res = await runCli(module, path, args, opts)
      if (res.exitCode !== 0) {
        const detail = (res.stderr.trim() || res.stdout.trim()).slice(0, 200)
        throw new Error(`${commandKey(module, path)} exited ${res.exitCode}${detail ? `: ${detail}` : ''}`)
      }
      return res
    },
    fixtures,
    check(cond, msg) {
      if (!cond) throw new Error(msg)
    },
    defer(fn) {
      restores.push(fn)
    },
  }
  let failure: string | undefined
  try {
    await s.run(ctx)
  } catch (err) {
    failure = (err as Error).message
  } finally {
    for (const restore of restores.reverse()) {
      try {
        await restore()
      } catch (err) {
        failure = failure ?? `restore failed: ${(err as Error).message}`
      }
    }
  }
  return failure
    ? { name: s.name, module: s.module, outcome: 'fail', detail: failure }
    : { name: s.name, module: s.module, outcome: 'pass' }
}
