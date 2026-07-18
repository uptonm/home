import { existsSync } from 'node:fs'
import type { Subprocess } from 'bun'
import { SystemError } from './errors'

export interface ProcessOptions {
  cwd?: string
  timeoutMs?: number
  /** Per-stream cap; output beyond it is discarded and the stream flagged truncated. */
  maxOutputBytes?: number
  /** Applied to stdout/stderr/error text before it reaches any returned field or thrown error. */
  redact?: (text: string) => string
}

export interface ProcessResult {
  stdout: string
  stderr: string
  /** null when the process died from a signal — see `signal`. */
  exitCode: number | null
  signal: string | null
  timedOut: boolean
  stdoutTruncated: boolean
  stderrTruncated: boolean
}

const DEFAULTS = {
  timeoutMs: 30_000,
  maxOutputBytes: 1_048_576,
}

/**
 * Run an external binary with an argument array — never a shell, so argv
 * elements are passed to the process literally. Nonzero exits and signal
 * deaths come back in the result for the caller to judge; only failures to
 * spawn at all are thrown, as SystemError with a stable `code`:
 * `process_not_found`, `process_cwd_not_found`, or `process_spawn_failed`.
 */
export async function runProcess(
  argv: readonly [string, ...string[]],
  opts: ProcessOptions = {},
): Promise<ProcessResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const maxOutputBytes = opts.maxOutputBytes ?? DEFAULTS.maxOutputBytes
  const redact = opts.redact ?? ((text: string) => text)

  let proc: Subprocess<'ignore', 'pipe', 'pipe'>
  try {
    proc = Bun.spawn({
      cmd: [...argv],
      cwd: opts.cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (err) {
    throw toSpawnError(err, argv[0], opts.cwd, redact)
  }

  let timedOut = false
  const killTimer = setTimeout(() => {
    const alreadyExited = proc.exitCode !== null || proc.signalCode !== null
    if (alreadyExited) return
    timedOut = true
    proc.kill('SIGKILL')
  }, timeoutMs)

  try {
    const [stdout, stderr] = await Promise.all([
      readCapped(proc.stdout, maxOutputBytes),
      readCapped(proc.stderr, maxOutputBytes),
      proc.exited,
    ])
    return {
      stdout: redact(stdout.text),
      stderr: redact(stderr.text),
      exitCode: proc.exitCode,
      signal: proc.signalCode,
      timedOut,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
    }
  } finally {
    clearTimeout(killTimer)
  }
}

async function readCapped(
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ text: string; truncated: boolean }> {
  const chunks: Uint8Array[] = []
  let bytesKept = 0
  let truncated = false
  for await (const chunk of stream) {
    // Past the cap, keep draining without keeping: stopping reads would let
    // the pipe buffer fill and block the child forever.
    if (truncated) continue
    const remaining = maxBytes - bytesKept
    if (chunk.byteLength > remaining) {
      chunks.push(chunk.subarray(0, remaining))
      bytesKept = maxBytes
      truncated = true
    } else {
      chunks.push(chunk)
      bytesKept += chunk.byteLength
    }
  }
  return { text: Buffer.concat(chunks).toString('utf8'), truncated }
}

function toSpawnError(
  err: unknown,
  binary: string,
  cwd: string | undefined,
  redact: (text: string) => string,
): SystemError {
  const errno = (err as { code?: string }).code
  if (errno === 'ENOENT') {
    // posix_spawn reports a missing cwd as the same ENOENT as a missing
    // binary, with a message naming the binary — check the cwd ourselves so
    // the two failures don't get conflated.
    if (cwd !== undefined && !existsSync(cwd)) {
      return new SystemError(redact(`working directory not found: ${cwd}`), 'process_cwd_not_found')
    }
    return new SystemError(redact(`binary not found: ${binary}`), 'process_not_found')
  }
  const message = err instanceof Error ? err.message : String(err)
  return new SystemError(redact(`failed to spawn ${binary}: ${message}`), 'process_spawn_failed')
}
