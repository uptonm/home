import { describe, expect, test } from 'bun:test'
import { routesGet, routesList } from '../modules/unifi/commands/routes'
import { dpiAppsGet, dpiAppsList } from '../modules/unifi/commands/dpi-apps'
import { dpiGroupsGet, dpiGroupsList } from '../modules/unifi/commands/dpi-groups'
import { radiusAccountsGet, radiusAccountsList } from '../modules/unifi/commands/radius-accounts'
import { dynamicDnsList } from '../modules/unifi/commands/dynamic-dns'
import { settingsGet, settingsList } from '../modules/unifi/commands/settings'

const EMPTY_CTX = { config: {}, json: false, quiet: true, verbose: false, log: null as unknown as ReturnType<typeof import('consola').createConsola>, args: {} }
function errCode(r: { ok: boolean; code?: string }): string | undefined { return r.ok ? undefined : r.code }

// Shared pattern test helper
function checkListGet(label: string, list: { path: string[] }, get: { path: string[]; args: { name: string }[] }, runGet: (ctx: typeof EMPTY_CTX) => Promise<{ ok: boolean; code?: string }>) {
  describe(label, () => {
    test('list path', () => expect(list.path).toEqual([label, 'list']))
    test('get path', () => expect(get.path).toEqual([label, 'get']))
    test('get rejects empty arg', async () => expect(errCode(await runGet({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg'))
  })
}

function mkRun(get: { run: (ctx: typeof EMPTY_CTX) => Promise<{ ok: boolean; code?: string }> }) {
  return (ctx: typeof EMPTY_CTX) => get.run(ctx)
}

checkListGet('routes', routesList, routesGet, mkRun(routesGet))
checkListGet('dpi-apps', dpiAppsList, dpiAppsGet, mkRun(dpiAppsGet))
checkListGet('dpi-groups', dpiGroupsList, dpiGroupsGet, mkRun(dpiGroupsGet))
checkListGet('radius-accounts', radiusAccountsList, radiusAccountsGet, mkRun(radiusAccountsGet))

describe('dynamic-dns', () => {
  test('list path', () => expect(dynamicDnsList.path).toEqual(['dynamic-dns', 'list']))
})

describe('settings', () => {
  test('list path', () => expect(settingsList.path).toEqual(['settings', 'list']))
  test('get path', () => expect(settingsGet.path).toEqual(['settings', 'get']))
  test('get rejects empty key', async () => expect(errCode(await settingsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg'))
})