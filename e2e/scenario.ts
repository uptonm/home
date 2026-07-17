import { runCli } from './cli'
import { fixtures } from './fixtures'

export interface ScenarioCtx {
  cli: typeof runCli
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
