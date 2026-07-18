import { join } from 'node:path'
import { moduleByName } from '../src/registry'
import type { CommandSpec } from '../src/core/types'

const REPO_ROOT = join(import.meta.dir, '..')

export class RefusedError extends Error {}

export interface CliResult {
  exitCode: number
  stdout: string
  stderr: string
  json: unknown
}

export const exercised = new Set<string>()

export function commandKey(module: string, path: string[]): string {
  return [module, ...path].join(' ')
}

export function findCommand(module: string, path: string[]): CommandSpec | null {
  const m = moduleByName[module]
  if (!m) return null
  const want = path.join(' ')
  return m.commands.find((c) => c.path.join(' ') === want) ?? null
}

export const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_KILL_GRACE_MS = 5_000

export interface SpawnHomeOpts {
  timeoutMs: number
  /** Delay after SIGTERM before escalating to SIGKILL. Injectable for tests; defaults to 5s. */
  killGraceMs?: number
}

/**
 * Spawn a raw command and enforce a timeout with SIGKILL escalation: a child
 * that traps or ignores SIGTERM would otherwise wedge a pool lane forever.
 */
export async function spawnHome(argv: string[], opts: SpawnHomeOpts): Promise<CliResult> {
  const proc = Bun.spawn(argv, {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const killGraceMs = opts.killGraceMs ?? DEFAULT_KILL_GRACE_MS
  const sigtermTimer = setTimeout(() => proc.kill(), opts.timeoutMs)
  const sigkillTimer = setTimeout(() => proc.kill('SIGKILL'), opts.timeoutMs + killGraceMs)
  const exitCode = await proc.exited
  clearTimeout(sigtermTimer)
  clearTimeout(sigkillTimer)
  const stdout = await new Response(proc.stdout).text()
  const stderr = await new Response(proc.stderr).text()
  let json: unknown = null
  try {
    json = JSON.parse(stdout)
  } catch {
    /* non-JSON output stays null; callers assert on exitCode first */
  }
  return { exitCode, stdout, stderr, json }
}

function spawnHomeCli(argv: string[], timeoutMs: number): Promise<CliResult> {
  return spawnHome(['bun', 'src/index.ts', ...argv, '--json'], { timeoutMs })
}

export async function runCli(
  module: string,
  path: string[],
  args: string[] = [],
  opts: { timeoutMs?: number } = {},
): Promise<CliResult> {
  const cmd = findCommand(module, path)
  if (!cmd) throw new RefusedError(`unknown command: ${commandKey(module, path)}`)
  if (cmd.effect === 'destructive') {
    throw new RefusedError(`destructive command refused: ${commandKey(module, path)}`)
  }
  exercised.add(commandKey(module, path))
  return spawnHomeCli([module, ...path, ...args], opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
}

export async function runStatus(module: string): Promise<CliResult> {
  if (!moduleByName[module]) throw new RefusedError(`unknown module: ${module}`)
  return spawnHomeCli([module, 'status'], DEFAULT_TIMEOUT_MS)
}
