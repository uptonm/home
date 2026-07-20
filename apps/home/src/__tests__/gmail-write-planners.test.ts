import { describe, expect, test } from 'bun:test'
import { buildFilterSpec, parseCsv, planMessageModify } from '../modules/gmail/commands/shared'

describe('parseCsv', () => {
  test('splits, trims, drops empties, dedups', () => {
    expect(parseCsv('INBOX, UNREAD ,,INBOX')).toEqual(['INBOX', 'UNREAD'])
  })
  test('undefined → empty array', () => {
    expect(parseCsv(undefined)).toEqual([])
  })
})

describe('planMessageModify', () => {
  test('requires a selection', () => {
    const p = planMessageModify({ archive: true })
    expect('error' in p && p.error).toMatch(/--q or --ids/)
  })

  test('rejects both q and ids', () => {
    const p = planMessageModify({ q: 'is:unread', ids: 'm1,m2', archive: true })
    expect('error' in p && p.error).toMatch(/not both/)
  })

  test('requires at least one action', () => {
    const p = planMessageModify({ q: 'is:unread' })
    expect('error' in p && p.error).toMatch(/no action/)
  })

  test('archive → remove INBOX; mark-read → remove UNREAD', () => {
    const p = planMessageModify({ q: 'from:x', archive: true, 'mark-read': true })
    if ('error' in p) throw new Error(p.error)
    expect(p.selection).toEqual({ kind: 'query', q: 'from:x' })
    expect(p.removeLabelIds.sort()).toEqual(['INBOX', 'UNREAD'])
    expect(p.addLabelIds).toEqual([])
    expect(p.trash).toBe(false)
  })

  test('add/remove label csvs feed the deltas, deduped with sugar flags', () => {
    const p = planMessageModify({ ids: 'm1,m2', add: 'Label_3', remove: 'INBOX', archive: true })
    if ('error' in p) throw new Error(p.error)
    expect(p.selection).toEqual({ kind: 'ids', ids: ['m1', 'm2'] })
    expect(p.addLabelIds).toEqual(['Label_3'])
    expect(p.removeLabelIds).toEqual(['INBOX']) // archive's INBOX not duplicated
  })

  test('trash is exclusive with other actions', () => {
    const p = planMessageModify({ q: 'x', trash: true, archive: true })
    expect('error' in p && p.error).toMatch(/trash cannot be combined/)
  })

  test('trash alone is valid', () => {
    const p = planMessageModify({ q: 'from:spam', trash: true })
    if ('error' in p) throw new Error(p.error)
    expect(p.trash).toBe(true)
    expect(p.summary.toLowerCase()).toContain('trash')
  })
})

describe('buildFilterSpec', () => {
  test('requires a criterion', () => {
    const s = buildFilterSpec({ add: 'Label_1' })
    expect('error' in s && s.error).toMatch(/criterion/)
  })

  test('requires an action', () => {
    const s = buildFilterSpec({ from: 'x@y.com' })
    expect('error' in s && s.error).toMatch(/action/)
  })

  test('maps criteria + action flags', () => {
    const s = buildFilterSpec({ from: 'news@shop.com', subject: 'sale', add: 'Label_3', archive: true, 'mark-read': true })
    if ('error' in s) throw new Error(s.error)
    expect(s.criteria).toEqual({ from: 'news@shop.com', subject: 'sale' })
    expect(s.action.addLabelIds).toEqual(['Label_3'])
    expect(s.action.removeLabelIds!.sort()).toEqual(['INBOX', 'UNREAD'])
  })

  test('has-attachment criterion flows through', () => {
    const s = buildFilterSpec({ query: 'older_than:1y', 'has-attachment': true, archive: true })
    if ('error' in s) throw new Error(s.error)
    expect(s.criteria).toEqual({ query: 'older_than:1y', hasAttachment: true })
  })
})
