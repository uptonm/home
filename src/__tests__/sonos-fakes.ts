import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { RunContext } from '../core/types'

/**
 * Shared scaffolding for the sonos command tests. Not a `*.test.ts` file, so
 * the bun test runner ignores it; it only provides helpers the real test files
 * import.
 */

/** A RunContext with no args — spread it and override `.args` per test. */
export const EMPTY_CTX: RunContext = {
  config: {},
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as RunContext['log'],
  args: {},
}

/**
 * Cast a structural stub (only the service methods a command touches) to a
 * SonosDevice. The commands reach a tiny slice of the real device, so a partial
 * literal is enough — the cast keeps the call sites honest without us having to
 * build a whole device.
 */
export function asDevice(stub: Record<string, unknown>): SonosDevice {
  return stub as unknown as SonosDevice
}

export function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

/** Pull `.data` off a successful RunResult for assertions. */
export function data<T = Record<string, unknown>>(r: { ok: boolean; data?: unknown }): T {
  return (r as { data: T }).data
}
