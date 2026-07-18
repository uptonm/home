import { describe, expect, test } from 'bun:test'
import { portProfilesGet, portProfilesList } from '../modules/unifi/commands/port-profiles'
import { wlanGroupsGet, wlanGroupsList } from '../modules/unifi/commands/wlan-groups'
import { userGroupsGet, userGroupsList } from '../modules/unifi/commands/user-groups'
import { radiusProfilesGet, radiusProfilesList } from '../modules/unifi/commands/radius-profiles'

const EMPTY_CTX = { config: {}, json: false, quiet: true, verbose: false, log: null as unknown as ReturnType<typeof import('consola').createConsola>, args: {} }

function errCode(r: { ok: boolean; code?: string }): string | undefined {
  return r.ok ? undefined : r.code
}

describe('unifi port-profiles', () => {
  test('port-profiles list path', () => expect(portProfilesList.path).toEqual(['port-profiles', 'list']))
  test('port-profiles get path', () => expect(portProfilesGet.path).toEqual(['port-profiles', 'get']))
  test('port-profiles get rejects empty name', async () => expect(errCode(await portProfilesGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg'))
})

describe('unifi wlan-groups', () => {
  test('wlan-groups list path', () => expect(wlanGroupsList.path).toEqual(['wlan-groups', 'list']))
  test('wlan-groups get path', () => expect(wlanGroupsGet.path).toEqual(['wlan-groups', 'get']))
  test('wlan-groups get rejects empty name', async () => expect(errCode(await wlanGroupsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg'))
})

describe('unifi user-groups', () => {
  test('user-groups list path', () => expect(userGroupsList.path).toEqual(['user-groups', 'list']))
  test('user-groups get path', () => expect(userGroupsGet.path).toEqual(['user-groups', 'get']))
  test('user-groups get rejects empty name', async () => expect(errCode(await userGroupsGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg'))
})

describe('unifi radius-profiles', () => {
  test('radius-profiles list path', () => expect(radiusProfilesList.path).toEqual(['radius-profiles', 'list']))
  test('radius-profiles get path', () => expect(radiusProfilesGet.path).toEqual(['radius-profiles', 'get']))
  test('radius-profiles get rejects empty name', async () => expect(errCode(await radiusProfilesGet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg'))
})