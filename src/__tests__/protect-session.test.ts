import { describe, expect, test } from 'bun:test'
import { statSync } from 'node:fs'
import { clearSession, parseJwtExp, readSessionStore, writeSessionStore } from '../modules/protect/client'

const base64url = (obj: unknown): string =>
  Buffer.from(JSON.stringify(obj)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('parseJwtExp', () => {
  test('extracts exp from a bare JWT', () => {
    const jwt = `${base64url({ alg: 'HS256' })}.${base64url({ exp: 1893456000 })}.sig`
    expect(parseJwtExp(jwt)).toBe(1893456000)
  })

  test('extracts exp when wrapped as a Set-Cookie value with attributes', () => {
    const jwt = `${base64url({ alg: 'HS256' })}.${base64url({ exp: 1893456000 })}.sig`
    expect(parseJwtExp(`TOKEN=${jwt}; Path=/; HttpOnly`)).toBe(1893456000)
  })

  test('returns null for a value with no dots', () => {
    expect(parseJwtExp('not-a-jwt')).toBeNull()
  })

  test('returns null for a non-JSON payload segment', () => {
    const bogus = `${base64url({ alg: 'HS256' })}.not-base64-json.sig`
    expect(parseJwtExp(bogus)).toBeNull()
  })

  test('returns null when the payload has no numeric exp', () => {
    const jwt = `${base64url({ alg: 'HS256' })}.${base64url({ sub: 'user' })}.sig`
    expect(parseJwtExp(jwt)).toBeNull()
  })

  test('never throws on garbage input', () => {
    expect(() => parseJwtExp('')).not.toThrow()
    expect(parseJwtExp('')).toBeNull()
  })
})

describe('session store round-trip', () => {
  test('write then read returns the same session', () => {
    const stored = { key: 'host.example user1', cookie: 'TOKEN=fake.fake.fake', csrfToken: 'csrf-fake', exp: 1893456000 }
    writeSessionStore(stored)
    expect(readSessionStore()).toEqual(stored)
    clearSession()
  })

  test('clearSession deletes the disk store', () => {
    writeSessionStore({ key: 'host.example user1', cookie: 'TOKEN=fake.fake.fake', csrfToken: 'csrf-fake', exp: null })
    clearSession()
    expect(readSessionStore()).toBeNull()
  })

  test('written file mode is 0600', () => {
    const stored = { key: 'host.example user1', cookie: 'TOKEN=fake.fake.fake', csrfToken: 'csrf-fake', exp: null }
    writeSessionStore(stored)
    const path = `${process.env.XDG_CONFIG_HOME}/home/.protect-session`
    expect(statSync(path).mode & 0o777).toBe(0o600)
    clearSession()
  })

  test('readSessionStore returns null when no file exists', () => {
    clearSession()
    expect(readSessionStore()).toBeNull()
  })
})
