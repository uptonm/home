import { describe, expect, test } from 'bun:test'
import { effectiveSource, withSource } from '../modules/unifi/integration-client'
import type { UnifiConfig } from '../modules/unifi/client'

const cfg = (source?: string): UnifiConfig => ({ url: '', site: 'default', apiKey: '', ...(source ? { source } as any : {}) })

describe('effectiveSource', () => {
  test('defaults to auto', () => expect(effectiveSource(cfg())).toBe('auto'))
  test('honors source = network', () => expect(effectiveSource(cfg('network'))).toBe('network'))
  test('honors source = integration', () => expect(effectiveSource(cfg('integration'))).toBe('integration'))
})

describe('withSource', () => {
  test('integration source skips network entirely', async () => {
    const result = await withSource(cfg('integration'), () => Promise.reject(new Error('should not be called')), () => Promise.resolve('integration-data'))
    expect(result).toBe('integration-data')
  })

  test('network source returns network result on success', async () => {
    const result = await withSource(cfg('network'), () => Promise.resolve('network-data'), () => Promise.resolve('integration-data'))
    expect(result).toBe('network-data')
  })

  test('network source does NOT fall back on error', async () => {
    const promise = withSource(cfg('network'), () => Promise.reject({ code: 'http_401' }), () => Promise.resolve('integration-data'))
    await expect(promise).rejects.toEqual({ code: 'http_401' })
  })

  test('auto source falls back on 401/403/404', async () => {
    const result = await withSource(cfg('auto'), () => Promise.reject({ code: 'http_401' }), () => Promise.resolve('integration-data'))
    expect(result).toBe('integration-data')
  })

  test('auto source falls back on 404', async () => {
    const result = await withSource(cfg('auto'), () => Promise.reject({ code: 'http_404' }), () => Promise.resolve('fallback'))
    expect(result).toBe('fallback')
  })

  test('auto source does NOT fall back on other errors', async () => {
    const promise = withSource(cfg('auto'), () => Promise.reject({ code: 'timeout' }), () => Promise.resolve('fallback'))
    await expect(promise).rejects.toEqual({ code: 'timeout' })
  })
})
