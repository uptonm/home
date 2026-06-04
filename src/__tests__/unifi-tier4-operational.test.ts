import { describe, expect, test } from 'bun:test'
import { clientsAll, dpiStatsClient, dpiStatsSite, eventsList, alarmsList, rogueApsList, guestsList, sessionsList } from '../modules/unifi/commands/operational'

const EMPTY_CTX = { config: {}, json: false, quiet: true, verbose: false, log: null as unknown as ReturnType<typeof import('consola').createConsola>, args: {} }
function errCode(r: { ok: boolean; code?: string }): string | undefined { return r.ok ? undefined : r.code }

describe('unifi clients all', () => {
  test('path is clients all', () => expect(clientsAll.path).toEqual(['clients', 'all']))
})

describe('unifi events', () => {
  test('path is events list', () => expect(eventsList.path).toEqual(['events', 'list']))
  test('has optional limit arg', () => {
    const l = eventsList.args.find((a) => a.name === 'limit')
    expect(l).toBeDefined()
    expect(l?.required).toBe(false)
  })
})

describe('unifi alarms', () => {
  test('path is alarms list', () => expect(alarmsList.path).toEqual(['alarms', 'list']))
})

describe('unifi rogue-aps', () => {
  test('path is rogue-aps list', () => expect(rogueApsList.path).toEqual(['rogue-aps', 'list']))
})

describe('unifi guests', () => {
  test('path is guests list', () => expect(guestsList.path).toEqual(['guests', 'list']))
})

describe('unifi sessions', () => {
  test('path is sessions list', () => expect(sessionsList.path).toEqual(['sessions', 'list']))
  test('has optional limit arg', () => {
    const l = sessionsList.args.find((a) => a.name === 'limit')
    expect(l).toBeDefined()
    expect(l?.required).toBe(false)
  })
})

describe('unifi dpi-stats', () => {
  test('site path', () => expect(dpiStatsSite.path).toEqual(['dpi-stats', 'site']))
  test('client path', () => expect(dpiStatsClient.path).toEqual(['dpi-stats', 'client']))
  test('client rejects empty mac', async () => expect(errCode(await dpiStatsClient.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg'))
  test('client rejects invalid mac', async () => expect(errCode(await dpiStatsClient.run({ ...EMPTY_CTX, args: { mac: 'bad' } }))).toBe('invalid_arg'))
})
