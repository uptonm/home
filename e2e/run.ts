import { modules } from '../src/registry'
import type { ArgSpec, CommandSpec } from '../src/core/types'
import { commandKey, exercised, runCli, runStatus } from './cli'
import { Unresolved, argProviders } from './args'
import { runScenario, type Scenario, type ScenarioResult } from './scenario'
import { sonosScenarios } from './scenarios/sonos'

interface ReadResult {
  key: string
  outcome: 'pass' | 'fail' | 'unresolved'
  detail?: string
}

const allScenarios: Scenario[] = [...sonosScenarios]

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
  return { key, outcome: 'pass' }
}

async function main() {
  const argv = process.argv.slice(2)
  const dryRun = argv.includes('--dry-run')
  const readsOnly = argv.includes('--reads-only')
  const moduleFilter = argv.includes('--module') ? argv[argv.indexOf('--module') + 1] : null

  const targets = modules.filter((m) => !moduleFilter || m.name === moduleFilter)
  if (moduleFilter && targets.length === 0) {
    console.error(`unknown module: ${moduleFilter}`)
    process.exit(1)
  }

  const skippedModules: Array<{ module: string; reason: string }> = []
  const reads: ReadResult[] = []
  const scenarioResults: ScenarioResult[] = []

  for (const m of targets) {
    const readCmds = m.commands.filter((c) => c.effect === 'read')
    const moduleScenarios = readsOnly ? [] : allScenarios.filter((s) => s.module === m.name)

    if (dryRun) {
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
      for (const s of moduleScenarios) console.log(`  scenario: ${s.name}`)
      continue
    }

    console.log(`\n== ${m.name}: preflight`)
    const status = await runStatus(m.name)
    if (status.exitCode === 3) {
      skippedModules.push({ module: m.name, reason: 'not configured' })
      console.log('   SKIP (not configured)')
      continue
    }
    if (status.exitCode !== 0) {
      // 143 = SIGTERM from our own timeout kill
      const reason = status.exitCode === 143 ? 'status timed out' : `status exited ${status.exitCode}`
      skippedModules.push({ module: m.name, reason })
      console.log(`   SKIP (${reason})`)
      continue
    }

    console.log(`== ${m.name}: ${readCmds.length} auto-reads`)
    for (const c of readCmds) {
      const r = await autoRead(m.name, c)
      reads.push(r)
      console.log(`   ${r.outcome.toUpperCase().padEnd(10)} ${r.key}${r.detail ? ` — ${r.detail}` : ''}`)
    }

    for (const s of moduleScenarios) {
      console.log(`== ${m.name}: scenario ${s.name}`)
      const r = await runScenario(s)
      scenarioResults.push(r)
      console.log(`   ${r.outcome.toUpperCase()} ${r.name}${r.detail ? ` — ${r.detail}` : ''}`)
    }
  }

  if (dryRun) return

  const allCommands = targets.flatMap((m) => m.commands.map((c) => ({ m: m.name, c })))
  const destructive = allCommands.filter(({ c }) => c.effect === 'destructive')
  const skippedNames = new Set(skippedModules.map((s) => s.module))
  const unexercised = allCommands.filter(
    ({ m, c }) => c.effect !== 'destructive' && !skippedNames.has(m) && !exercised.has(commandKey(m, c.path)),
  )
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
  if (failedReads.length || failedScenarios.length) {
    console.log('\nRESULT: FAIL')
    process.exit(1)
  }
  console.log('\nRESULT: PASS')
}

await main()
