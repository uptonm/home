import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SystemError } from '../core/errors'
import { runProcess } from '../core/process'

// `sh -c` appears below only as a fixture target the adapter spawns — the
// adapter itself must never invoke a shell, which the metacharacter tests prove.

describe('runProcess', () => {
  describe('capture and exit codes', () => {
    test('captures stdout on success', async () => {
      const result = await runProcess(['echo', 'hello'])
      expect(result.stdout).toBe('hello\n')
      expect(result.stderr).toBe('')
      expect(result.exitCode).toBe(0)
      expect(result.signal).toBeNull()
      expect(result.timedOut).toBe(false)
      expect(result.stdoutTruncated).toBe(false)
      expect(result.stderrTruncated).toBe(false)
    })

    test('captures stdout and stderr independently', async () => {
      const result = await runProcess(['sh', '-c', 'echo out; echo err >&2'])
      expect(result.stdout).toBe('out\n')
      expect(result.stderr).toBe('err\n')
      expect(result.exitCode).toBe(0)
    })

    test('preserves a nonzero exit code without throwing', async () => {
      const result = await runProcess(['sh', '-c', 'echo failing >&2; exit 42'])
      expect(result.exitCode).toBe(42)
      expect(result.stderr).toBe('failing\n')
      expect(result.timedOut).toBe(false)
    })

    test('reports a signal death as exitCode null plus the signal name', async () => {
      const result = await runProcess(['sh', '-c', 'kill -TERM $$'])
      expect(result.exitCode).toBeNull()
      expect(result.signal).toBe('SIGTERM')
      expect(result.timedOut).toBe(false)
    })

    test('does not hang on a binary that reads stdin', async () => {
      const result = await runProcess(['cat'], { timeoutMs: 5_000 })
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('')
      expect(result.timedOut).toBe(false)
    })
  })

  describe('no shell interpretation', () => {
    test('passes metacharacters through as literal argv elements', async () => {
      const hostileArgs = ['$(whoami)', '`id`', 'a b', ';', 'rm -rf /', '&&', '|', '>out', "'quoted'", '$HOME']
      const result = await runProcess(['echo', ...hostileArgs])
      expect(result.stdout).toBe(hostileArgs.join(' ') + '\n')
      expect(result.exitCode).toBe(0)
    })

    test('an argument with spaces stays one argument', async () => {
      const result = await runProcess(['sh', '-c', 'echo "argc=$#"', 'argv0', 'one two three'])
      expect(result.stdout).toBe('argc=1\n')
    })
  })

  describe('cwd', () => {
    test('runs in the requested directory', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'home-process-test-'))
      try {
        const result = await runProcess(['pwd'], { cwd: dir })
        expect(result.stdout).toBe(dir + '\n')
        expect(result.exitCode).toBe(0)
      } finally {
        rmSync(dir, { recursive: true, force: true })
      }
    })

    test('a missing cwd throws process_cwd_not_found, not process_not_found', async () => {
      expect.assertions(3)
      try {
        await runProcess(['echo', 'hi'], { cwd: '/definitely/not/a/real/dir' })
      } catch (err) {
        expect(err).toBeInstanceOf(SystemError)
        expect((err as SystemError).code).toBe('process_cwd_not_found')
        expect((err as SystemError).message).toContain('/definitely/not/a/real/dir')
      }
    })
  })

  describe('timeout', () => {
    test('kills a sleeping process and flags timedOut', async () => {
      const startedAt = Date.now()
      const result = await runProcess(['sleep', '30'], { timeoutMs: 200 })
      expect(result.timedOut).toBe(true)
      expect(result.exitCode).toBeNull()
      expect(result.signal).toBe('SIGKILL')
      expect(Date.now() - startedAt).toBeLessThan(5_000)
    })

    test('a fast process is untouched by the timeout', async () => {
      const result = await runProcess(['echo', 'quick'], { timeoutMs: 5_000 })
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toBe('quick\n')
    })
  })

  describe('output caps', () => {
    test('caps stdout at maxOutputBytes and flags truncation', async () => {
      const result = await runProcess(['sh', '-c', 'head -c 100000 /dev/zero | tr "\\0" x'], {
        maxOutputBytes: 1_000,
      })
      expect(result.stdout).toBe('x'.repeat(1_000))
      expect(result.stdoutTruncated).toBe(true)
      expect(result.stderrTruncated).toBe(false)
      expect(result.exitCode).toBe(0)
    })

    test('caps stderr independently of stdout', async () => {
      const result = await runProcess(['sh', '-c', 'head -c 100000 /dev/zero | tr "\\0" x >&2; echo ok'], {
        maxOutputBytes: 1_000,
      })
      expect(result.stderr).toBe('x'.repeat(1_000))
      expect(result.stderrTruncated).toBe(true)
      expect(result.stdout).toBe('ok\n')
      expect(result.stdoutTruncated).toBe(false)
    })

    test('output exactly at the cap is not flagged truncated', async () => {
      const result = await runProcess(['printf', 'aaaa'], { maxOutputBytes: 4 })
      expect(result.stdout).toBe('aaaa')
      expect(result.stdoutTruncated).toBe(false)
    })

    test('one byte over the cap is truncated to the cap', async () => {
      const result = await runProcess(['printf', 'aaaaa'], { maxOutputBytes: 4 })
      expect(result.stdout).toBe('aaaa')
      expect(result.stdoutTruncated).toBe(true)
    })

    test('drains past the cap so a chatty child still exits cleanly', async () => {
      // 4 MiB is far beyond the OS pipe buffer: if the adapter stopped reading
      // at the cap, the child would block on write and this would time out.
      const result = await runProcess(['sh', '-c', 'head -c 4194304 /dev/zero | tr "\\0" x; echo done >&2'], {
        maxOutputBytes: 100,
        timeoutMs: 10_000,
      })
      expect(result.exitCode).toBe(0)
      expect(result.timedOut).toBe(false)
      expect(result.stdout).toBe('x'.repeat(100))
      expect(result.stdoutTruncated).toBe(true)
      expect(result.stderr).toBe('done\n')
    })
  })

  describe('missing binary', () => {
    test('throws SystemError with the stable process_not_found code', async () => {
      expect.assertions(3)
      try {
        await runProcess(['definitely-not-a-real-binary-xyz'])
      } catch (err) {
        expect(err).toBeInstanceOf(SystemError)
        expect((err as SystemError).code).toBe('process_not_found')
        expect((err as SystemError).message).toContain('definitely-not-a-real-binary-xyz')
      }
    })
  })

  describe('redaction', () => {
    const redact = (text: string) => text.replaceAll('hunter2', '[REDACTED]')

    test('applies to stdout and stderr on success', async () => {
      const result = await runProcess(['sh', '-c', 'echo "token=hunter2"; echo "err hunter2" >&2'], { redact })
      expect(result.stdout).toBe('token=[REDACTED]\n')
      expect(result.stderr).toBe('err [REDACTED]\n')
    })

    test('applies to stderr on a nonzero exit', async () => {
      const result = await runProcess(['sh', '-c', 'echo "auth failed for hunter2" >&2; exit 1'], { redact })
      expect(result.exitCode).toBe(1)
      expect(result.stderr).toBe('auth failed for [REDACTED]\n')
      expect(result.stderr).not.toContain('hunter2')
    })

    test('applies to thrown spawn errors', async () => {
      expect.assertions(2)
      try {
        await runProcess(['gh-wrapper-hunter2'], { redact })
      } catch (err) {
        expect((err as SystemError).message).toContain('[REDACTED]')
        expect((err as SystemError).message).not.toContain('hunter2')
      }
    })
  })
})
