import { moduleByName, modules } from '../src/registry'
import { commandKey, exercised } from './cli'
import { argProviders } from './args'
import { createLive } from './live'
import { runModule, scenarios, type ModuleResult } from './module'

type Module = (typeof modules)[number]

interface Options {
  dryRun: boolean
  readsOnly: boolean
  moduleFilter: string | null
  concurrency: number
}

/**
 * Strict, fail-closed argv parsing. A typo here must never widen the run: a
 * `--module` with a missing or unknown value would otherwise silently select
 * every module and execute all write scenarios against the house.
 */
function parseArgs(argv: string[]): Options {
  let dryRun = false
  let readsOnly = false
  let moduleFilter: string | null = null
  let concurrency = 8
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (arg === '--dry-run') dryRun = true
    else if (arg === '--reads-only') readsOnly = true
    else if (arg === '--module') {
      const value = argv[++i]
      if (value === undefined || value.startsWith('-')) {
        console.error('--module requires a module name')
        process.exit(1)
      }
      if (!moduleByName[value]) {
        console.error(`unknown module: ${value}`)
        process.exit(1)
      }
      moduleFilter = value
    } else if (arg === '--concurrency') {
      const value = argv[++i]
      const n = Number(value)
      if (value === undefined || !Number.isInteger(n) || n < 1) {
        console.error('--concurrency requires a positive integer')
        process.exit(1)
      }
      concurrency = n
    } else {
      console.error(`unknown argument: ${arg}`)
      process.exit(1)
    }
  }
  return { dryRun, readsOnly, moduleFilter, concurrency }
}

function printPlan(targets: Module[]): void {
  for (const m of targets) {
    const readCmds = m.commands.filter((c) => c.effect === 'read')
    console.log(`\n${m.name}: ${readCmds.length} auto-reads`)
    for (const c of readCmds) {
      const key = commandKey(m.name, c.path)
      const how = argProviders[key]
        ? 'provider'
        : c.args.some((a) => a.required)
          ? 'UNRESOLVED (no provider)'
          : 'no args'
      console.log(`  ${key}  [${how}]`)
    }
    for (const s of scenarios.filter((s) => s.module === m.name)) console.log(`  scenario: ${s.name}`)
  }
}

function printReport(targets: Module[], results: ModuleResult[]): boolean {
  const allCommands = targets.flatMap((m) => m.commands.map((c) => ({ m: m.name, c })))
  const destructive = allCommands.filter(({ c }) => c.effect === 'destructive')
  const skippedModules = results
    .filter((r) => r.skipped)
    .map((r) => ({ module: r.module, reason: r.skipped!.reason }))
  const skippedNames = new Set(skippedModules.map((s) => s.module))
  const unexercised = allCommands.filter(
    ({ m, c }) => c.effect !== 'destructive' && !skippedNames.has(m) && !exercised.has(commandKey(m, c.path)),
  )
  const reads = results.flatMap((r) => r.reads)
  const scenarioResults = results.flatMap((r) => r.scenarios)
  const failedReads = reads.filter((r) => r.outcome === 'fail')
  const unresolvedReads = reads.filter((r) => r.outcome === 'unresolved')
  const failedScenarios = scenarioResults.filter((r) => r.outcome === 'fail')

  console.log('\n================ e2e report ================')
  console.log(`commands in scope:   ${allCommands.length}`)
  console.log(`exercised:           ${exercised.size}`)
  console.log(`reads pass/fail:     ${reads.filter((r) => r.outcome === 'pass').length}/${failedReads.length}`)
  console.log(`scenarios pass/fail: ${scenarioResults.length - failedScenarios.length}/${failedScenarios.length}`)
  console.log(`skipped modules:     ${skippedModules.map((s) => `${s.module} (${s.reason})`).join(', ') || 'none'}`)
  console.log(`destructive (never run by design): ${destructive.length}`)
  if (unresolvedReads.length) {
    console.log('\nunresolved reads (needs a provider or live data):')
    for (const r of unresolvedReads) console.log(`  - ${r.key}: ${r.detail}`)
  }
  if (unexercised.length) {
    console.log('\nneeds attention (runnable but never exercised):')
    for (const { m, c } of unexercised) console.log(`  - [${c.effect}] ${commandKey(m, c.path)}`)
  }
  const failed = failedReads.length > 0 || failedScenarios.length > 0
  console.log(failed ? '\nRESULT: FAIL' : '\nRESULT: PASS')
  return failed
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const targets = modules.filter((m) => !opts.moduleFilter || m.name === opts.moduleFilter)

  if (opts.dryRun) {
    printPlan(targets)
    return
  }

  const results: ModuleResult[] = []
  for (const m of targets) {
    const live = createLive(m.name)
    const r = await runModule(m, live, { readsOnly: opts.readsOnly })
    results.push(r)
    const line = r.skipped
      ? `SKIP (${r.skipped.reason})`
      : `${live.outcome?.toUpperCase()} — ${r.reads.filter((x) => x.outcome === 'pass').length}/${r.reads.length} reads`
    console.log(`${m.name.padEnd(14)} ${line}`)
  }

  const failed = printReport(targets, results)
  if (failed) process.exit(1)
}

await main()
