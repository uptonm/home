import { afterEach, describe, expect, mock, test } from 'bun:test'
import { NotConfiguredError } from '../core/errors'
import { GMAIL_MODIFY_SCOPE, GMAIL_SETTINGS_BASIC_SCOPE } from '../modules/gmail/client'

let grantedScopes: string[] | null = [GMAIL_MODIFY_SCOPE, GMAIL_SETTINGS_BASIC_SCOPE]
let profileThrows: Error | null = null

const realClient = await import('../modules/gmail/client')
const realAuth = await import('../core/google-auth')

mock.module('../modules/gmail/client', () => ({
  ...realClient,
  readGmailCredentials: () => {
    if (profileThrows instanceof NotConfiguredError) throw profileThrows
    return { clientId: 'c', clientSecret: 's', refreshToken: 'r' }
  },
  getProfile: async () => {
    if (profileThrows) throw profileThrows
    return { emailAddress: 'me@gmail.com', messagesTotal: 10, threadsTotal: 8 }
  },
}))

mock.module('../core/google-auth', () => ({
  ...realAuth,
  getGrantedScopes: async () => grantedScopes,
}))

const { manifest } = await import('../modules/gmail/index')

afterEach(() => {
  grantedScopes = [GMAIL_MODIFY_SCOPE, GMAIL_SETTINGS_BASIC_SCOPE]
  profileThrows = null
})

describe('gmail status scope verification', () => {
  test('all required scopes present → ok with granted scopes', async () => {
    const res = await manifest.status({})
    expect(res.ok).toBe(true)
    const data = (res as { data: { status: string; scopes: { granted: string[] } } }).data
    expect(data.status).toBe('authenticated')
    expect(data.scopes.granted).toContain(GMAIL_MODIFY_SCOPE)
  })

  test('missing a write scope → config error naming the gap and the fix', async () => {
    grantedScopes = ['https://www.googleapis.com/auth/gmail.readonly']
    const res = await manifest.status({})
    expect(res.ok).toBe(false)
    const r = res as { kind: string; code?: string; message: string }
    expect(r.code).toBe('insufficient_scope')
    expect(r.kind).toBe('config')
    expect(r.message).toContain('me@gmail.com')
    expect(r.message).toContain(GMAIL_MODIFY_SCOPE)
    expect(r.message).toContain('configure')
  })

  test('scopes unreported by Google → ok, marked unknown (does not hard-fail)', async () => {
    grantedScopes = null
    const res = await manifest.status({})
    expect(res.ok).toBe(true)
    expect((res as { data: { scopes: string } }).data.scopes).toBe('unknown')
  })

  test('unconfigured → config not_configured', async () => {
    profileThrows = new NotConfiguredError('gmail', 'google_unauthorized')
    const res = await manifest.status({})
    expect(res.ok).toBe(false)
    expect((res as { code?: string }).code).toBe('not_configured')
  })
})
