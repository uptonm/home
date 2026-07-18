import { describe, expect, test } from 'bun:test'
import { pool } from '../../e2e/pool'

describe('pool', () => {
  test('never exceeds the concurrency limit and preserves input order', async () => {
    const items = Array.from({ length: 20 }, (_, i) => i)
    let inFlight = 0
    let maxInFlight = 0
    const results = await pool(items, 4, async (n) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 5))
      inFlight--
      return n * 2
    })
    expect(maxInFlight).toBeLessThanOrEqual(4)
    expect(maxInFlight).toBeGreaterThan(1)
    expect(results).toEqual(items.map((n) => n * 2))
  })

  test('empty input resolves to empty results', async () => {
    const results = await pool([], 4, async () => 1)
    expect(results).toEqual([])
  })

  test('a limit larger than the item count still runs each item once', async () => {
    const seen: number[] = []
    const results = await pool([1, 2, 3], 10, async (n) => {
      seen.push(n)
      return n
    })
    expect(seen.slice().sort()).toEqual([1, 2, 3])
    expect(results).toEqual([1, 2, 3])
  })
})
