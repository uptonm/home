/**
 * Fixture provenance — Uptime Kuma 1.23.X branch source
 * (github.com/louislam/uptime-kuma @ 1.23.X), cross-checked against a live
 * 1.23.17 instance where noted:
 *
 *  - GET /api/status-page/:slug → {config, incident, publicGroupList, maintenanceList}:
 *    server/routers/status-page-router.js + server/model/status_page.js
 *    `getStatusPageData` / `toPublicJSON`
 *  - group/monitor shapes: server/model/group.js + server/model/monitor.js
 *    `toPublicJSON` — `url` only when sendUrl is set; `certExpiryDaysRemaining`
 *    + `validCert` only when the page sets showCertificateExpiry and the
 *    monitor is http/keyword/json-query over https; `getCertExpiry` returns
 *    {certExpiryDaysRemaining: "", validCert: false} when no valid cert is stored
 *  - incident shape: server/model/incident.js `toPublicJSON`; createdDate is
 *    UTC "YYYY-MM-DD HH:mm:ss" (R.isoDateTime(dayjs.utc()) in
 *    server/socket-handlers/status-page-socket-handler.js)
 *  - maintenance shape: server/model/maintenance.js `toPublicJSON`;
 *    "single"-strategy timeslots carry raw local start/end dates anchored by
 *    timezoneOffset, cron/recurring timeslots are dayjs.toISOString() output
 *  - GET /api/status-page/heartbeat/:slug → {heartbeatList, uptimeList}:
 *    status-page-router.js — ≤50 beats per monitor, oldest→newest, beat shape
 *    from server/model/heartbeat.js `toPublicJSON` (status ints 0 DOWN / 1 UP /
 *    2 PENDING / 3 MAINTENANCE; time UTC "YYYY-MM-DD HH:mm:ss.SSS" via
 *    R.isoDateTimeMillis in monitor.js `beat`; msg blanked for public);
 *    uptimeList values are 0..1 ratios keyed `<monitorID>_24`
 *  - EMPTY_HEARTBEATS and MANIFEST_404_BODY captured live from Uptime Kuma
 *    1.23.17 (GET /api/status-page/heartbeat/<bad-slug> returns 200 with empty
 *    maps; only .../manifest.json 404s — the config route hangs on a bad slug)
 */
import type { RawHeartbeat, RawHeartbeatPayload, RawStatusPage } from '../modules/uptime-kuma/client'

export const PAGE_CONFIG = {
  slug: 'home',
  title: 'Homelab Status',
  description: 'Services behind uptonm.io',
  icon: '/icon.svg',
  theme: 'auto',
  published: true,
  showTags: false,
  customCSS: '',
  footerText: null,
  showPoweredBy: false,
  googleAnalyticsId: null,
  showCertificateExpiry: true,
}

export const MONITOR_CADDY = {
  id: 1,
  name: 'caddy',
  sendUrl: 0,
  type: 'http',
  certExpiryDaysRemaining: 12,
  validCert: true,
}

export const MONITOR_ATLAS = {
  id: 2,
  name: 'atlas',
  sendUrl: 1,
  url: 'https://atlas.uptonm.io',
  type: 'http',
  certExpiryDaysRemaining: '',
  validCert: false,
}

export const MONITOR_SONOS = {
  id: 3,
  name: 'sonos-bridge',
  sendUrl: 0,
  type: 'ping',
}

export const INCIDENT_PINNED = {
  id: 7,
  style: 'warning',
  title: 'Degraded uploads',
  content: 'Object storage is slow; uploads may time out.',
  pin: 1,
  createdDate: '2026-07-16 20:00:00',
  lastUpdatedDate: '2026-07-17 08:30:00',
}

export const MAINTENANCE_SINGLE = {
  id: 4,
  title: 'Router firmware',
  description: 'UniFi upgrade window',
  strategy: 'single',
  intervalDay: 1,
  active: true,
  dateRange: ['2026-07-20 02:00:00', '2026-07-20 04:00:00'],
  timeRange: [{ hours: 2, minutes: 0 }, { hours: 4, minutes: 0 }],
  weekdays: [],
  daysOfMonth: [],
  timeslotList: [{ startDate: '2026-07-20 02:00:00', endDate: '2026-07-20 04:00:00' }],
  cron: null,
  duration: null,
  durationMinutes: null,
  timezone: 'America/New_York',
  timezoneOption: 'America/New_York',
  timezoneOffset: '-04:00',
  status: 'under-maintenance',
}

export const MAINTENANCE_CRON = {
  id: 5,
  title: 'Nightly backup',
  description: null,
  strategy: 'cron',
  intervalDay: 1,
  active: true,
  dateRange: [null],
  timeRange: [{ hours: 0, minutes: 0 }, { hours: 0, minutes: 0 }],
  weekdays: [],
  daysOfMonth: [],
  timeslotList: [{ startDate: '2026-07-17T09:00:00.000Z', endDate: '2026-07-17T10:00:00.000Z' }],
  cron: '0 9 * * *',
  duration: 3600,
  durationMinutes: 60,
  timezone: 'UTC',
  timezoneOption: 'SAME_AS_SERVER',
  timezoneOffset: '+00:00',
  status: 'under-maintenance',
}

export const STATUS_PAGE_RESPONSE: RawStatusPage = {
  config: PAGE_CONFIG,
  incident: INCIDENT_PINNED,
  publicGroupList: [
    { id: 1, name: 'Core', weight: 1, monitorList: [MONITOR_CADDY, MONITOR_ATLAS] },
    { id: 2, name: 'Media', weight: 2, monitorList: [MONITOR_SONOS] },
  ],
  maintenanceList: [MAINTENANCE_SINGLE, MAINTENANCE_CRON],
}

export const STATUS_PAGE_QUIET: RawStatusPage = {
  config: { ...PAGE_CONFIG, showCertificateExpiry: false },
  incident: null,
  publicGroupList: [{ id: 1, name: 'Core', weight: 1, monitorList: [MONITOR_SONOS] }],
  maintenanceList: [],
}

export const HEARTBEATS: RawHeartbeatPayload = {
  heartbeatList: {
    '1': [
      { status: 1, time: '2026-07-17 09:20:00.000', msg: '', ping: 12 },
      { status: 1, time: '2026-07-17 09:21:00.000', msg: '', ping: 18 },
      { status: 1, time: '2026-07-17 09:22:00.123', msg: '', ping: 15 },
    ],
    '2': [
      { status: 1, time: '2026-07-17 09:20:30.000', msg: '', ping: 40 },
      { status: 0, time: '2026-07-17 09:21:30.000', msg: '', ping: null },
    ],
    '3': [{ status: 3, time: '2026-07-17 09:15:00.000', msg: '', ping: 22 }],
  },
  uptimeList: { '1_24': 0.9987, '2_24': 0.5, '3_24': 1 },
}

/** Captured live from 1.23.17: heartbeat route with an unknown slug (200, not 404). */
export const EMPTY_HEARTBEATS: RawHeartbeatPayload = { heartbeatList: {}, uptimeList: {} }

/** Captured live from 1.23.17: GET /api/status-page/<bad-slug>/manifest.json → 404. */
export const MANIFEST_404_BODY = { status: 'fail', msg: 'Not Found' }

/** server/routers/status-page-router.js manifest route for an existing page. */
export const MANIFEST_OK = {
  name: 'Homelab Status',
  start_url: '/status/home',
  display: 'standalone',
  icons: [{ src: '/icon.svg', sizes: '128x128', type: 'image/png' }],
}

export function upBeats(count: number): RawHeartbeat[] {
  return Array.from({ length: count }, (_, i) => ({
    status: 1,
    time: `2026-07-17 08:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}.000`,
    msg: '',
    ping: 10 + (i % 5),
  }))
}
