import { describe, expect, mock, test } from 'bun:test'
import { PlayMode } from '@svrooij/sonos/lib/models'
import { EMPTY_CTX, asDevice, data, errCode, realSonosClient } from './sonos-fakes'

interface Calls {
  setPlayMode: string[]
  setCrossfade: boolean[]
  sleep: string[]
  seek: Array<{ Unit: string; Target: string }>
  setBass: number[]
  setTreble: number[]
  setLoudness: boolean[]
  setVol: Array<{ Channel: string; DesiredVolume: number }>
  nightMode: boolean[]
  speech: boolean[]
  groupVol: number[]
  groupMute: boolean[]
}

function makeDevice(opts: { playMode?: string; crossfade?: boolean; remaining?: string; groupMute?: boolean } = {}) {
  const calls: Calls = {
    setPlayMode: [], setCrossfade: [], sleep: [], seek: [], setBass: [], setTreble: [],
    setLoudness: [], setVol: [], nightMode: [], speech: [], groupVol: [], groupMute: [],
  }
  const dev = asDevice({
    Name: 'Kitchen',
    Uuid: 'K',
    AVTransportService: {
      GetTransportSettings: async () => ({ PlayMode: opts.playMode ?? 'NORMAL', RecQualityMode: '' }),
      SetPlayMode: async (i: { NewPlayMode: string }) => { calls.setPlayMode.push(i.NewPlayMode); return true },
      GetCrossfadeMode: async () => ({ CrossfadeMode: opts.crossfade ?? false }),
      SetCrossfadeMode: async (i: { CrossfadeMode: boolean }) => { calls.setCrossfade.push(i.CrossfadeMode); return true },
      GetRemainingSleepTimerDuration: async () => ({ RemainingSleepTimerDuration: opts.remaining ?? '', CurrentSleepTimerGeneration: 1 }),
      ConfigureSleepTimer: async (i: { NewSleepTimerDuration: string }) => { calls.sleep.push(i.NewSleepTimerDuration); return true },
      Seek: async (i: { Unit: string; Target: string }) => { calls.seek.push({ Unit: i.Unit, Target: i.Target }); return true },
    },
    RenderingControlService: {
      GetBass: async () => ({ CurrentBass: 3 }),
      GetTreble: async () => ({ CurrentTreble: -1 }),
      GetLoudness: async () => ({ CurrentLoudness: true }),
      GetVolume: async (i: { Channel: string }) => ({ CurrentVolume: i.Channel === 'LF' ? 100 : 50 }),
      SetBass: async (i: { DesiredBass: number }) => { calls.setBass.push(i.DesiredBass); return true },
      SetTreble: async (i: { DesiredTreble: number }) => { calls.setTreble.push(i.DesiredTreble); return true },
      SetLoudness: async (i: { DesiredLoudness: boolean }) => { calls.setLoudness.push(i.DesiredLoudness); return true },
      SetVolume: async (i: { Channel: string; DesiredVolume: number }) => { calls.setVol.push({ Channel: i.Channel, DesiredVolume: i.DesiredVolume }); return true },
    },
    GroupRenderingControlService: {
      GetGroupVolume: async () => ({ CurrentVolume: 42 }),
      SetGroupVolume: async (i: { DesiredVolume: number }) => { calls.groupVol.push(i.DesiredVolume); return true },
      GetGroupMute: async () => ({ CurrentMute: opts.groupMute ?? false }),
      SetGroupMute: async (i: { DesiredMute: boolean }) => { calls.groupMute.push(i.DesiredMute); return true },
    },
    GetNightMode: async () => true,
    SetNightMode: async (v: boolean) => { calls.nightMode.push(v); return true },
    GetSpeechEnhancement: async () => false,
    SetSpeechEnhancement: async (v: boolean) => { calls.speech.push(v); return true },
  })
  return { dev, calls }
}

let injected: ReturnType<typeof asDevice> | null = null
const realClient = await import('../modules/sonos/client')
mock.module('../modules/sonos/client', () => ({
  ...realClient,
  withRoom: async (_c: unknown, _o: unknown, fn: (d: ReturnType<typeof asDevice>) => unknown) => fn(injected!),
}))

const { playModeGet, playModeSet, playModeToFlags, flagsToPlayMode } = await import('../modules/sonos/commands/play-mode')
const { eqGet, eqSet, balanceToChannels, channelsToBalance } = await import('../modules/sonos/commands/eq')
const { sleepTimerGet, sleepTimerSet } = await import('../modules/sonos/commands/sleep-timer')
const { groupVolumeGet, groupVolumeSet, groupMute } = await import('../modules/sonos/commands/group-volume')
const { seek } = await import('../modules/sonos/commands/seek')

describe('playModeToFlags / flagsToPlayMode round-trip', () => {
  // Drive off the enum itself so a new PlayMode can't silently skip the round-trip.
  const modes = Object.values(PlayMode)
  test('every PlayMode decomposes and recombines to itself', () => {
    for (const m of modes) expect(flagsToPlayMode(playModeToFlags(m))).toBe(m)
  })
  test('SHUFFLE means shuffle + repeat all', () => {
    expect(playModeToFlags('SHUFFLE')).toEqual({ shuffle: true, repeat: 'all' })
  })
})

describe('play-mode get/set', () => {
  test('get reports decomposed flags + crossfade', async () => {
    injected = makeDevice({ playMode: 'SHUFFLE', crossfade: true }).dev
    const res = await playModeGet.run({ ...EMPTY_CTX, args: {} })
    expect(data(res)).toMatchObject({ shuffle: true, repeat: 'all', crossfade: true, raw: 'SHUFFLE' })
  })
  test('partial set preserves the unspecified flag', async () => {
    const { dev, calls } = makeDevice({ playMode: 'NORMAL' })
    injected = dev
    await playModeSet.run({ ...EMPTY_CTX, args: { shuffle: 'on' } })
    expect(calls.setPlayMode).toEqual(['SHUFFLE_NOREPEAT'])
  })
  test('crossfade set issues SetCrossfadeMode', async () => {
    const { dev, calls } = makeDevice({})
    injected = dev
    await playModeSet.run({ ...EMPTY_CTX, args: { crossfade: 'on' } })
    expect(calls.setCrossfade).toEqual([true])
  })
  test('validation', async () => {
    injected = makeDevice({}).dev
    expect(errCode(await playModeSet.run({ ...EMPTY_CTX, args: {} }))).toBe('missing_arg')
    expect(errCode(await playModeSet.run({ ...EMPTY_CTX, args: { repeat: 'sometimes' } }))).toBe('bad_arg')
  })
})

describe('eq balance math', () => {
  test('balanceToChannels', () => {
    expect(balanceToChannels(0)).toEqual({ lf: 100, rf: 100 })
    expect(balanceToChannels(-50)).toEqual({ lf: 100, rf: 50 })
    expect(balanceToChannels(50)).toEqual({ lf: 50, rf: 100 })
    expect(balanceToChannels(-100)).toEqual({ lf: 100, rf: 0 })
  })
  test('channelsToBalance is the inverse', () => {
    expect(channelsToBalance(100, 50)).toBe(-50)
    expect(channelsToBalance(50, 100)).toBe(50)
    expect(channelsToBalance(100, 100)).toBe(0)
  })
})

describe('eq get/set', () => {
  test('get reports each setting (balance derived from LF/RF)', async () => {
    injected = makeDevice({}).dev
    const res = await eqGet.run({ ...EMPTY_CTX, args: { room: 'kitchen' } })
    expect(data(res)).toMatchObject({ bass: 3, treble: -1, loudness: true, balance: -50, nightMode: true, speechEnhancement: false })
  })
  test('set applies only the passed flags', async () => {
    const { dev, calls } = makeDevice({})
    injected = dev
    await eqSet.run({ ...EMPTY_CTX, args: { room: 'kitchen', bass: 4, balance: -50 } })
    expect(calls.setBass).toEqual([4])
    expect(calls.setTreble).toEqual([])
    expect(calls.setVol).toEqual([{ Channel: 'LF', DesiredVolume: 100 }, { Channel: 'RF', DesiredVolume: 50 }])
  })
  test('validation', async () => {
    injected = makeDevice({}).dev
    expect(errCode(await eqSet.run({ ...EMPTY_CTX, args: { room: 'kitchen' } }))).toBe('missing_arg')
    expect(errCode(await eqSet.run({ ...EMPTY_CTX, args: { room: 'kitchen', bass: 99 } }))).toBe('bad_arg')
  })
})

describe('sleep-timer get/set', () => {
  test('get reports active + remaining', async () => {
    injected = makeDevice({ remaining: '0:14:30' }).dev
    expect(data(await sleepTimerGet.run({ ...EMPTY_CTX, args: {} }))).toMatchObject({ active: true, remaining: '0:14:30' })
  })
  test('set 30m configures 0:30:00', async () => {
    const { dev, calls } = makeDevice({})
    injected = dev
    await sleepTimerSet.run({ ...EMPTY_CTX, args: { room: 'kitchen', duration: '30m' } })
    expect(calls.sleep).toEqual(['0:30:00'])
  })
  test('set off cancels', async () => {
    const { dev, calls } = makeDevice({})
    injected = dev
    await sleepTimerSet.run({ ...EMPTY_CTX, args: { room: 'kitchen', duration: 'off' } })
    expect(calls.sleep).toEqual([''])
  })
  test('validation', async () => {
    injected = makeDevice({}).dev
    expect(errCode(await sleepTimerSet.run({ ...EMPTY_CTX, args: { room: 'kitchen', duration: 'huh' } }))).toBe('bad_arg')
  })
})

describe('group-volume + group-mute', () => {
  test('get group volume', async () => {
    injected = makeDevice({}).dev
    expect(data(await groupVolumeGet.run({ ...EMPTY_CTX, args: {} })).volume).toBe(42)
  })
  test('set group volume', async () => {
    const { dev, calls } = makeDevice({})
    injected = dev
    await groupVolumeSet.run({ ...EMPTY_CTX, args: { room: 'kitchen', level: 25 } })
    expect(calls.groupVol).toEqual([25])
  })
  test('set group volume rejects out-of-range', async () => {
    injected = makeDevice({}).dev
    expect(errCode(await groupVolumeSet.run({ ...EMPTY_CTX, args: { room: 'kitchen', level: 250 } }))).toBe('bad_arg')
  })
  test('group-mute toggles from current state', async () => {
    const { dev, calls } = makeDevice({ groupMute: false })
    injected = dev
    await groupMute.run({ ...EMPTY_CTX, args: { room: 'kitchen' } })
    expect(calls.groupMute).toEqual([true])
  })
  test('group-mute explicit on', async () => {
    const { dev, calls } = makeDevice({ groupMute: false })
    injected = dev
    await groupMute.run({ ...EMPTY_CTX, args: { room: 'kitchen', state: 'on' } })
    expect(calls.groupMute).toEqual([true])
  })
})

describe('seek', () => {
  test('seeks REL_TIME from a clock value', async () => {
    const { dev, calls } = makeDevice({})
    injected = dev
    await seek.run({ ...EMPTY_CTX, args: { room: 'kitchen', position: '1:30' } })
    expect(calls.seek).toEqual([{ Unit: 'REL_TIME', Target: '0:01:30' }])
  })
  test('rejects a bad position', async () => {
    injected = makeDevice({}).dev
    expect(errCode(await seek.run({ ...EMPTY_CTX, args: { room: 'kitchen', position: 'soon' } }))).toBe('bad_arg')
  })
})
