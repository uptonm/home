import { describe, expect, test } from 'bun:test'
import { parseOnOff, parseTimeToSeconds, secondsToHms, parseSleepTimerArg } from '../modules/sonos/parse'

describe('parseOnOff', () => {
  test('truthy synonyms', () => {
    for (const v of ['on', 'ON', 'true', '1', 'yes', 'enable']) expect(parseOnOff(v)).toBe(true)
  })
  test('falsy synonyms', () => {
    for (const v of ['off', 'false', '0', 'no', 'disable']) expect(parseOnOff(v)).toBe(false)
  })
  test('unrecognized returns null', () => {
    expect(parseOnOff('maybe')).toBeNull()
    expect(parseOnOff('')).toBeNull()
  })
})

describe('parseTimeToSeconds', () => {
  test('bare seconds', () => {
    expect(parseTimeToSeconds('90')).toBe(90)
    expect(parseTimeToSeconds('0')).toBe(0)
  })
  test('unit suffixes', () => {
    expect(parseTimeToSeconds('30s')).toBe(30)
    expect(parseTimeToSeconds('5m')).toBe(300)
    expect(parseTimeToSeconds('1h')).toBe(3600)
  })
  test('clock formats', () => {
    expect(parseTimeToSeconds('1:30')).toBe(90)
    expect(parseTimeToSeconds('1:02:03')).toBe(3723)
    expect(parseTimeToSeconds('0:00')).toBe(0)
  })
  test('rejects malformed input', () => {
    expect(parseTimeToSeconds('')).toBeNull()
    expect(parseTimeToSeconds('abc')).toBeNull()
    expect(parseTimeToSeconds('1:90')).toBeNull() // seconds >= 60
    expect(parseTimeToSeconds('1:2:3:4')).toBeNull()
    expect(parseTimeToSeconds('-5')).toBeNull()
    expect(parseTimeToSeconds('1.5m')).toBeNull()
  })
})

describe('secondsToHms', () => {
  test('formats H:MM:SS', () => {
    expect(secondsToHms(90)).toBe('0:01:30')
    expect(secondsToHms(3723)).toBe('1:02:03')
    expect(secondsToHms(0)).toBe('0:00:00')
  })
  test('clamps negatives to zero', () => {
    expect(secondsToHms(-10)).toBe('0:00:00')
  })
})

describe('parseSleepTimerArg', () => {
  test('cancel synonyms map to empty string', () => {
    for (const v of ['off', 'cancel', 'none', 'clear', 'stop', '0', '']) expect(parseSleepTimerArg(v)).toBe('')
  })
  test('durations map to H:MM:SS', () => {
    expect(parseSleepTimerArg('30m')).toBe('0:30:00')
    expect(parseSleepTimerArg('1h')).toBe('1:00:00')
    expect(parseSleepTimerArg('1:30:00')).toBe('1:30:00')
  })
  test('rejects junk and over-a-day durations', () => {
    expect(parseSleepTimerArg('soon')).toBeNull()
    expect(parseSleepTimerArg('25h')).toBeNull()
  })
})
