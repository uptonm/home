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

async function spawnHome(argv: string[], timeoutMs: number): Promise<CliResult> {
  const proc = Bun.spawn(['bun', 'src/index.ts', ...argv, '--json'], {
    cwd: REPO_ROOT,
    stdout: 'pipe',
    stderr: 'pipe',
    stdin: 'ignore',
  })
  const timer = setTimeout(() => proc.kill(), timeoutMs)
  const exitCode = await proc.exited
  clearTimeout(timer)
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
  return spawnHome([module, ...path, ...args], opts.timeoutMs ?? 30_000)
}

export async function runStatus(module: string): Promise<CliResult> {
  if (!moduleByName[module]) throw new RefusedError(`unknown module: ${module}`)
  return spawnHome([module, 'status'], 30_000)
}
