import { describe, expect, test } from 'bun:test'
import type { RootStatusReport } from '../core/status'
import { renderStatus } from '../core/status-view'

const REPORT: RootStatusReport = {
  status: 'degraded',
  summary: { ok: 1, error: 1, notConfigured: 1 },
  modules: [
    { module: 'unifi', configured: true, status: 'ok', data: { status: 'reachable', sites: 1 } },
    {
      module: 'vercel',
      configured: true,
      status: 'error',
      message: 'HTTP 403 Forbidden from https://api.vercel.com/v1/env',
      code: 'status_failed',
    },
    { module: 'linear', configured: false, status: 'not_configured' },
  ],
}

describe('renderStatus', () => {
  test('shows each service with its state word and symbol', () => {
    const out = renderStatus(REPORT, { color: false })
    expect(out).toMatch(/✔ unifi\s+ok/)
    expect(out).toMatch(/✖ vercel\s+unreachable/)
    expect(out).toMatch(/○ linear\s+not configured/)
  })

  test('header carries the overall state and the counts', () => {
    const out = renderStatus(REPORT, { color: false })
    const header = out.split('\n')[0] ?? ''
    expect(header).toContain('home status')
    expect(header).toContain('degraded')
    expect(header).toContain('1 ok')
    expect(header).toContain('1 unreachable')
    expect(header).toContain('1 not configured')
  })

  test('drops per-module data and error detail — that lives in --json', () => {
    const out = renderStatus(REPORT, { color: false })
    expect(out).not.toContain('403')
    expect(out).not.toContain('status_failed')
    expect(out).not.toContain('sites')
  })

  test('no ANSI when color is off, ANSI when on', () => {
    expect(renderStatus(REPORT, { color: false })).not.toContain('\x1b[')
    expect(renderStatus(REPORT, { color: true })).toContain('\x1b[')
  })
})
