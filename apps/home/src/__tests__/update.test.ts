import { describe, expect, test } from 'bun:test'
import type { ProcessResult } from '../core/process'
import {
  bannerFor,
  bannerText,
  cacheIsStale,
  fetchLatestVersion,
  isNewerAvailable,
  normalizeVersion,
  parseLatestTag,
  relation,
  type BannerEnv,
  type UpdateCache,
} from '../core/update'

function procResult(overrides: Partial<ProcessResult>): ProcessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode: 0,
    signal: null,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
    ...overrides,
  }
}

describe('normalizeVersion', () => {
  test('strips a leading v and trims', () => {
    expect(normalizeVersion(' v1.2.3 ')).toBe('1.2.3')
    expect(normalizeVersion('1.2.3')).toBe('1.2.3')
  })
})

describe('relation / isNewerAvailable', () => {
  test('detects a newer latest', () => {
    expect(relation('0.1.0', '0.2.0')).toBe('newer')
    expect(isNewerAvailable('0.1.0', '0.2.0')).toBe(true)
    expect(isNewerAvailable('v0.1.0', 'v0.2.0')).toBe(true)
  })

  test('equal and older are not upgrades', () => {
    expect(relation('0.2.0', '0.2.0')).toBe('same')
    expect(relation('0.3.0', '0.2.0')).toBe('older')
    expect(isNewerAvailable('0.2.0', '0.2.0')).toBe(false)
    expect(isNewerAvailable('0.3.0', '0.2.0')).toBe(false)
  })

  test('non-semver input is unknown, never a false upgrade', () => {
    expect(relation('0.1.0', 'nightly')).toBe('unknown')
    expect(relation('dev', '0.2.0')).toBe('unknown')
    expect(isNewerAvailable('0.1.0', 'nightly')).toBe(false)
  })
})

describe('cacheIsStale', () => {
  const now = 1_000_000_000_000
  test('null cache is always stale', () => {
    expect(cacheIsStale(null, now)).toBe(true)
  })
  test('fresh cache within the ttl is not stale', () => {
    const cache: UpdateCache = { latest: '0.2.0', checkedAt: now - 1000 }
    expect(cacheIsStale(cache, now)).toBe(false)
  })
  test('cache past the ttl is stale', () => {
    const cache: UpdateCache = { latest: '0.2.0', checkedAt: now - 25 * 60 * 60 * 1000 }
    expect(cacheIsStale(cache, now)).toBe(true)
  })
})

describe('bannerFor', () => {
  const base: BannerEnv = {
    current: '0.1.0',
    packaged: true,
    dirty: false,
    isTTY: true,
    json: false,
    ci: false,
    disabled: false,
    cache: { latest: '0.2.0', checkedAt: 0 },
  }

  test('shows a banner when a newer version is cached', () => {
    expect(bannerFor(base)).toBe(bannerText('0.1.0', '0.2.0'))
  })

  test('no banner when the cached version is not newer', () => {
    expect(bannerFor({ ...base, cache: { latest: '0.1.0', checkedAt: 0 } })).toBeNull()
    expect(bannerFor({ ...base, cache: { latest: '0.0.9', checkedAt: 0 } })).toBeNull()
  })

  test('no banner without a cache', () => {
    expect(bannerFor({ ...base, cache: null })).toBeNull()
  })

  test('each suppression rule wins independently', () => {
    expect(bannerFor({ ...base, packaged: false })).toBeNull()
    expect(bannerFor({ ...base, dirty: true })).toBeNull()
    expect(bannerFor({ ...base, isTTY: false })).toBeNull()
    expect(bannerFor({ ...base, json: true })).toBeNull()
    expect(bannerFor({ ...base, ci: true })).toBeNull()
    expect(bannerFor({ ...base, disabled: true })).toBeNull()
  })
})

describe('parseLatestTag', () => {
  test('extracts and normalizes tagName from gh JSON', () => {
    expect(parseLatestTag('{"tagName":"v0.2.0"}')).toBe('0.2.0')
  })
  test('null for non-semver or malformed output', () => {
    expect(parseLatestTag('{"tagName":"nightly"}')).toBeNull()
    expect(parseLatestTag('not json')).toBeNull()
    expect(parseLatestTag('{}')).toBeNull()
  })
})

describe('fetchLatestVersion', () => {
  test('returns the parsed tag on a clean gh exit', async () => {
    const run = (async () => procResult({ stdout: '{"tagName":"v0.3.0"}' })) as typeof import('../core/process').runProcess
    expect(await fetchLatestVersion(run)).toBe('0.3.0')
  })
  test('returns null when gh exits nonzero', async () => {
    const run = (async () => procResult({ exitCode: 1, stderr: 'not found' })) as typeof import('../core/process').runProcess
    expect(await fetchLatestVersion(run)).toBeNull()
  })
})

describe('bannerText', () => {
  test('names both versions and the upgrade command', () => {
    const text = bannerText('v0.1.0', '0.2.0')
    expect(text).toContain('v0.2.0')
    expect(text).toContain('v0.1.0')
    expect(text).toContain('home upgrade')
  })
})
