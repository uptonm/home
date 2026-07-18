/**
 * Small pure parsers shared across the Tier 3 settings commands (play-mode,
 * sleep-timer, eq, seek, group-mute). Kept here so they can be unit-tested
 * without touching a device.
 */

/** Parse "on"/"off" (and common synonyms) to a boolean; null if unrecognized. */
export function parseOnOff(v: unknown): boolean | null {
  const s = String(v).trim().toLowerCase()
  if (['on', 'true', '1', 'yes', 'enable', 'enabled'].includes(s)) return true
  if (['off', 'false', '0', 'no', 'disable', 'disabled'].includes(s)) return false
  return null
}

/**
 * Parse a time input to whole seconds. Accepts:
 *  - bare seconds: `"90"`
 *  - single unit suffix: `"30s"` / `"5m"` / `"1h"`
 *  - clock: `"m:ss"` or `"h:mm:ss"`
 * Returns null for anything malformed or negative.
 */
export function parseTimeToSeconds(input: string): number | null {
  const s = input.trim().toLowerCase()
  if (!s) return null

  if (s.includes(':')) {
    const parts = s.split(':')
    if (parts.length < 2 || parts.length > 3) return null
    const nums = parts.map((p) => (/^\d+$/.test(p) ? Number(p) : NaN))
    if (nums.some((n) => !Number.isFinite(n))) return null
    let h = 0
    let m = 0
    let sec = 0
    if (parts.length === 3) [h, m, sec] = nums as [number, number, number]
    else [m, sec] = nums as [number, number]
    if (m >= 60 || sec >= 60) return null
    return h * 3600 + m * 60 + sec
  }

  const unit = /^(\d+)(s|m|h)$/.exec(s)
  if (unit) {
    const n = Number(unit[1])
    return unit[2] === 'h' ? n * 3600 : unit[2] === 'm' ? n * 60 : n
  }

  if (/^\d+$/.test(s)) return Number(s)
  return null
}

/** Format whole seconds as `H:MM:SS` (Sonos REL_TIME / sleep-timer format). */
export function secondsToHms(total: number): string {
  const t = Math.max(0, Math.floor(total))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${h}:${pad(m)}:${pad(s)}`
}

/**
 * Parse a `sleep-timer set` argument. Returns:
 *  - `''` to cancel (`off` / `0` / `cancel` / `none` / `clear` / `stop` / empty)
 *  - an `H:MM:SS` duration string
 *  - null if invalid or beyond Sonos's one-day ceiling
 */
export function parseSleepTimerArg(input: string): string | null {
  const s = input.trim().toLowerCase()
  if (s === '' || ['off', 'cancel', 'none', 'clear', 'stop'].includes(s)) return ''
  const secs = parseTimeToSeconds(s)
  if (secs === null) return null
  if (secs === 0) return ''
  if (secs > 86399) return null
  return secondsToHms(secs)
}
