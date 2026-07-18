import { describe, expect, test } from 'bun:test'
import { spawnHome } from '../../e2e/cli'

describe('spawnHome SIGKILL escalation', () => {
  test('a child that traps SIGTERM is still killed and reports a nonzero exit', async () => {
    const result = await spawnHome(
      ['bun', '-e', 'process.on("SIGTERM",()=>{});setInterval(()=>{},1000)'],
      { timeoutMs: 100, killGraceMs: 200 },
    )
    expect(result.exitCode).not.toBe(0)
  }, 5000)
})
