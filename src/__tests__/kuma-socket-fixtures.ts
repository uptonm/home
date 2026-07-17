/**
 * Fixture provenance — Uptime Kuma 1.23.X branch source
 * (github.com/louislam/uptime-kuma @ 1.23.X, package version 1.23.17),
 * cross-checked against a live 1.23.17 instance where noted:
 *
 *  - pre-auth `info`: server.js io.on("connection") calls sendInfo(socket, true),
 *    which hides version/latestVersion/isContainer — INFO_PRE_AUTH was captured
 *    live from 1.23.17 (only primaryBaseURL, serverTimezone, serverTimezoneOffset)
 *  - `login` ack shapes: server.js socket.on("login") — {ok: true, token} on
 *    success, {tokenRequired: true} when the account has 2FA, {ok: false, msg:
 *    "Incorrect username or password."} on bad credentials
 *  - post-login `info`: afterLogin → sendInfo(socket) with version visible
 *  - `monitorList`: object keyed by monitor id → monitor.toJSON()
 *    (uptime-kuma-server.js getMonitorJSONList; fixtures carry a representative
 *    subset of toJSON's fields — the transport reads only id/name/type/url)
 *  - `heartbeatList`: (monitorID, rows, overwrite) — newest ≤100 raw heartbeat
 *    DB rows, oldest→newest (client.js sendHeartbeatList `SELECT * FROM
 *    heartbeat … ORDER BY time DESC LIMIT 100` + list.reverse()); unlike the
 *    public route, msg carries the check result / down reason; time is UTC
 *    "YYYY-MM-DD HH:mm:ss.SSS" (monitor.js beat, R.isoDateTimeMillis)
 *  - `uptime`: (monitorID, hours, ratio 0..1) — sendStats emits 24 and 720
 *    for every monitor (monitor.js sendUptime/calcUptime)
 *  - `certInfo`: (monitorID, info_json) — monitor_tls_info.info_json as a JSON
 *    STRING (monitor.js sendCertInfo); the object is util-server.js
 *    checkCertificate output: {valid, certInfo: {subject, issuer,
 *    subjectaltname, validTo, daysRemaining, validFor, certType, fingerprint,
 *    issuerCertificate → nested chain}}
 *  - `maintenanceList`: object keyed by id → maintenance.toJSON(), which is
 *    exactly toPublicJSON (model/maintenance.js) — all windows, any status
 */
import type { RawHeartbeat } from '../modules/uptime-kuma/client'
import { MAINTENANCE_CRON, MAINTENANCE_SINGLE } from './kuma-fixtures'

/** Captured live from 1.23.17: the only event an unauthenticated socket receives. */
export const INFO_PRE_AUTH = { primaryBaseURL: '', serverTimezone: 'UTC', serverTimezoneOffset: '+00:00' }

export const INFO_POST_LOGIN = {
  version: '1.23.17',
  latestVersion: '1.23.17',
  isContainer: true,
  primaryBaseURL: '',
  serverTimezone: 'UTC',
  serverTimezoneOffset: '+00:00',
}

export const LOGIN_OK = { ok: true, token: 'jwt-token' }
export const LOGIN_2FA = { tokenRequired: true }
export const LOGIN_BAD = { ok: false, msg: 'Incorrect username or password.' }

/** monitor.toJSON() subsets — representative fields only. */
export const SOCKET_MONITOR_LIST: Record<string, Record<string, unknown>> = {
  '1': {
    id: 1,
    name: 'caddy',
    type: 'http',
    url: 'https://caddy.uptonm.io',
    active: true,
    interval: 60,
    maintenance: false,
    pathName: 'caddy',
    tags: [],
  },
  '2': {
    id: 2,
    name: 'atlas',
    type: 'http',
    url: 'https://atlas.uptonm.io',
    active: true,
    interval: 60,
    maintenance: false,
    pathName: 'atlas',
    tags: [],
  },
  '3': {
    id: 3,
    name: 'sonos-bridge',
    type: 'ping',
    // Non-http monitors have no url in the DB (hostname is used instead).
    url: null,
    hostname: '10.0.14.60',
    active: true,
    interval: 60,
    maintenance: true,
    pathName: 'sonos-bridge',
    tags: [],
  },
}

/** A raw `SELECT * FROM heartbeat` row — RawHeartbeat's fields plus the DB-only columns. */
type RawBeatRow = RawHeartbeat & Record<string, unknown>

/** Raw heartbeat DB rows (snake_case columns), oldest→newest per monitor. */
export const SOCKET_BEATS: Record<string, RawBeatRow[]> = {
  '1': [
    { id: 901, monitor_id: 1, status: 1, time: '2026-07-17 09:20:00.000', msg: '200 - OK', ping: 12, important: 0, duration: 60, down_count: 0 },
    { id: 902, monitor_id: 1, status: 1, time: '2026-07-17 09:21:00.000', msg: '200 - OK', ping: 18, important: 0, duration: 60, down_count: 0 },
    { id: 903, monitor_id: 1, status: 1, time: '2026-07-17 09:22:00.123', msg: '200 - OK', ping: 15, important: 0, duration: 60, down_count: 0 },
  ],
  '2': [
    { id: 910, monitor_id: 2, status: 1, time: '2026-07-17 09:20:30.000', msg: '200 - OK', ping: 40, important: 0, duration: 60, down_count: 0 },
    { id: 911, monitor_id: 2, status: 0, time: '2026-07-17 09:21:30.000', msg: 'connect ECONNREFUSED 10.0.14.60:8090', ping: null, important: 1, duration: 60, down_count: 1 },
  ],
  '3': [
    { id: 920, monitor_id: 3, status: 3, time: '2026-07-17 09:15:00.000', msg: '', ping: 22, important: 0, duration: 60, down_count: 0 },
  ],
}

/** calcUptime ratios (0..1) sent as uptime(monitorID, 24, ratio). */
export const SOCKET_UPTIME_24: Record<string, number> = { '1': 0.9987, '2': 0.5, '3': 1 }

/** monitor_tls_info.info_json strings, exactly as the certInfo event carries them. */
export const SOCKET_CERTS: Record<string, string> = {
  '1': JSON.stringify({
    valid: true,
    certInfo: {
      subject: { CN: 'caddy.uptonm.io' },
      issuer: { C: 'US', O: "Let's Encrypt", CN: 'E6' },
      subjectaltname: 'DNS:caddy.uptonm.io',
      validTo: '2026-07-29T12:00:00.000Z',
      daysRemaining: 12,
      validFor: ['caddy.uptonm.io'],
      certType: 'server',
      fingerprint: 'AA:BB:CC',
      issuerCertificate: {
        valid: true,
        certInfo: { subject: { CN: 'E6' }, certType: 'intermediate CA', daysRemaining: 500, issuerCertificate: null },
      },
    },
  }),
  '2': JSON.stringify({
    valid: false,
    certInfo: {
      subject: { CN: 'atlas.uptonm.io' },
      issuer: { CN: 'atlas.uptonm.io' },
      subjectaltname: 'DNS:atlas.uptonm.io',
      validTo: '2026-06-01T00:00:00.000Z',
      daysRemaining: -46,
      validFor: ['atlas.uptonm.io'],
      certType: 'self signed',
      fingerprint: 'DD:EE:FF',
      issuerCertificate: null,
    },
  }),
}

/** maintenanceList payload: keyed by id, values identical to the public toPublicJSON shape. */
export const SOCKET_MAINTENANCE_LIST: Record<string, unknown> = {
  '4': MAINTENANCE_SINGLE,
  '5': MAINTENANCE_CRON,
}
