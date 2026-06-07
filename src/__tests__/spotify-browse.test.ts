import { describe, expect, mock, test } from 'bun:test'
import {
  buildCategoriesUrl,
  buildCategoryGetUrl,
  buildNewReleasesUrl,
} from '../modules/spotify/client'

const EMPTY_CTX = {
  config: { clientId: 'cid', clientSecret: 'csec' },
  json: false,
  quiet: true,
  verbose: false,
  log: null as unknown as ReturnType<typeof import('consola').createConsola>,
  args: {},
}

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

describe('browse URL builders', () => {
  test('new-releases and categories thread market/limit/offset; category get encodes id', () => {
    const nr = new URL(buildNewReleasesUrl({ market: 'US', limit: 10, offset: 5 }))
    expect(nr.pathname).toBe('/v1/browse/new-releases')
    expect(nr.searchParams.get('market')).toBe('US')
    expect(nr.searchParams.get('limit')).toBe('10')
    expect(nr.searchParams.get('offset')).toBe('5')

    expect(new URL(buildCategoriesUrl({ limit: 50 })).pathname).toBe('/v1/browse/categories')
    expect(buildCategoryGetUrl('toplists')).toBe('https://api.spotify.com/v1/browse/categories/toplists')
  })
})

const realClient = await import('../modules/spotify/client')

mock.module('../modules/spotify/client', () => ({
  ...realClient,
  listNewReleases: async (_cfg: unknown, opts: { market?: string; limit?: number }) => ({
    items: [{ kind: 'album', uri: 'spotify:album:alb1', title: opts.market ?? '', artist: 'X' }],
    total: 100,
    limit: opts.limit,
  }),
  listCategories: async () => ({ items: [{ kind: 'category', id: 'toplists', name: 'Top Lists' }], total: 1 }),
  getCategory: async (_cfg: unknown, id: string) => ({ kind: 'category', id, name: id.toUpperCase() }),
}))

const { newReleases, categoriesList, categoriesGet } = await import('../modules/spotify/commands/browse')

describe('spotify browse commands', () => {
  test('new-releases defaults market to US and clamps limit', async () => {
    const res = await newReleases.run({ ...EMPTY_CTX, args: { limit: 999 } })
    expect(res.ok).toBe(true)
    const data = (res as { data: { items: { title: string }[]; limit: number } }).data
    expect(data.items[0]!.title).toBe('US')
    expect(data.limit).toBe(50)
  })

  test('categories list returns shaped categories', async () => {
    const res = await categoriesList.run({ ...EMPTY_CTX, args: {} })
    expect((res as { data: { items: unknown[] } }).data.items).toHaveLength(1)
  })

  test('categories get passes a bare slug id straight through (no ref parsing)', async () => {
    const res = await categoriesGet.run({ ...EMPTY_CTX, args: { id: 'toplists' } })
    expect((res as { data: { kind: string; id: string; name: string } }).data).toEqual({ kind: 'category', id: 'toplists', name: 'TOPLISTS' })
  })

  test('categories get rejects a missing id', async () => {
    expect(errCode(await categoriesGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
  })

  test('new-releases rejects a malformed market', async () => {
    expect(errCode(await newReleases.run({ ...EMPTY_CTX, args: { market: 'USA' } }))).toBe('bad_arg')
  })

  test('command specs declare the expected paths', () => {
    expect(newReleases.path).toEqual(['new-releases'])
    expect(categoriesList.path).toEqual(['categories', 'list'])
    expect(categoriesGet.path).toEqual(['categories', 'get'])
  })
})
