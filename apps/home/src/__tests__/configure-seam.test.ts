import { describe, expect, test } from 'bun:test'
import { configureRunnerFor } from '../core/configure'
import type { ModuleManifest } from '../core/types'

const base: ModuleManifest = {
  name: 'fake',
  description: 'fake module',
  whenToUse: 'never',
  configSchema: [],
  commands: [],
  async status() {
    return { ok: true, data: {} }
  },
}

describe('configureRunnerFor', () => {
  test('returns the manifest override when one is declared', async () => {
    let called = false
    const manifest: ModuleManifest = {
      ...base,
      configure: async () => {
        called = true
      },
    }
    await configureRunnerFor(manifest)()
    expect(called).toBe(true)
  })

  test('falls back to a runner when no override is declared', () => {
    // No override: the returned runner is the generic prompt-driven path.
    // Calling it would block on stdin, so only its identity is asserted.
    expect(typeof configureRunnerFor(base)).toBe('function')
    expect(base.configure).toBeUndefined()
  })
})
