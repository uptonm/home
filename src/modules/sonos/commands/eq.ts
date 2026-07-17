import type { CommandSpec, RunResult } from '../../../core/types'
import { withRoom } from '../client'
import { parseOnOff } from '../parse'

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

/**
 * Sonos has no balance knob — balance is expressed by lowering one stereo
 * channel. Convention here: balance ∈ [-100, 100], -100 = hard left, +100 =
 * hard right, 0 = centered (both channels at 100).
 */
export function balanceToChannels(balance: number): { lf: number; rf: number } {
  const b = Math.max(-100, Math.min(100, Math.round(balance)))
  return b <= 0 ? { lf: 100, rf: 100 + b } : { lf: 100 - b, rf: 100 }
}

/** Inverse of balanceToChannels: recover the balance from the two channels. */
export function channelsToBalance(lf: number, rf: number): number {
  return Math.max(-100, Math.min(100, rf - lf))
}

export const eqGet: CommandSpec = {
  path: ['eq', 'get'],
  effect: 'read',
  description: 'Get a room\'s audio settings: bass, treble, loudness, balance, night-mode, speech-enhancement. Unsupported fields on a given speaker are omitted.',
  args: [{ name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: false }],
  examples: [
    'home sonos eq get kitchen',
    'home sonos eq get "living room" --json',
  ],
  async run(ctx) {
    return withRoom(ctx, { pick: 'device' }, async (d) => {
      // Every read is best-effort: bass/treble/loudness exist on all speakers,
      // but LF/RF (balance) only on stereo pairs and night/speech only on home
      // theater. A missing field is left undefined rather than failing the call.
      const [bass, treble, loudness, lf, rf, night, speech] = await Promise.all([
        d.RenderingControlService.GetBass({ InstanceID: 0 }).catch(() => null),
        d.RenderingControlService.GetTreble({ InstanceID: 0 }).catch(() => null),
        d.RenderingControlService.GetLoudness({ InstanceID: 0, Channel: 'Master' }).catch(() => null),
        d.RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'LF' }).catch(() => null),
        d.RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'RF' }).catch(() => null),
        d.GetNightMode().catch(() => null),
        d.GetSpeechEnhancement().catch(() => null),
      ])
      return {
        ok: true,
        data: {
          room: d.Name,
          bass: bass?.CurrentBass,
          treble: treble?.CurrentTreble,
          loudness: loudness?.CurrentLoudness,
          balance: lf && rf ? channelsToBalance(lf.CurrentVolume, rf.CurrentVolume) : undefined,
          nightMode: night ?? undefined,
          speechEnhancement: speech ?? undefined,
        },
      }
    })
  },
}

function readRange(v: unknown, lo: number, hi: number): number | null {
  const n = Number(v)
  if (!Number.isFinite(n) || n < lo || n > hi) return null
  return Math.round(n)
}

export const eqSet: CommandSpec = {
  path: ['eq', 'set'],
  effect: 'write',
  description: 'Set a room\'s audio settings. Only the flags you pass change. Bass/treble -10..10, balance -100 (left) .. 100 (right).',
  args: [
    roomArg,
    { name: 'bass', kind: 'number', description: 'Bass level -10..10' },
    { name: 'treble', kind: 'number', description: 'Treble level -10..10' },
    { name: 'loudness', kind: 'string', description: 'on | off' },
    { name: 'balance', kind: 'number', description: 'Balance -100 (left) .. 0 (center) .. 100 (right)' },
    { name: 'night-mode', kind: 'string', description: 'on | off (home theater)' },
    { name: 'speech', kind: 'string', description: 'on | off — speech/dialog enhancement (home theater)' },
  ],
  examples: [
    'home sonos eq set kitchen --bass 4 --treble -2',
    'home sonos eq set "living room" --loudness on',
    'home sonos eq set "home theater" --night-mode on --speech on',
  ],
  async run(ctx): Promise<RunResult> {
    let bass: number | undefined
    if (ctx.args.bass !== undefined) {
      const n = readRange(ctx.args.bass, -10, 10)
      if (n === null) return { ok: false, kind: 'user', message: 'bass must be -10..10', code: 'bad_arg' }
      bass = n
    }
    let treble: number | undefined
    if (ctx.args.treble !== undefined) {
      const n = readRange(ctx.args.treble, -10, 10)
      if (n === null) return { ok: false, kind: 'user', message: 'treble must be -10..10', code: 'bad_arg' }
      treble = n
    }
    let balance: number | undefined
    if (ctx.args.balance !== undefined) {
      const n = readRange(ctx.args.balance, -100, 100)
      if (n === null) return { ok: false, kind: 'user', message: 'balance must be -100..100', code: 'bad_arg' }
      balance = n
    }
    const flag = (key: string, label: string): boolean | undefined | { err: RunResult } => {
      if (ctx.args[key] === undefined) return undefined
      const p = parseOnOff(ctx.args[key])
      if (p === null) return { err: { ok: false, kind: 'user', message: `${label} must be on or off`, code: 'bad_arg' } }
      return p
    }
    const loudness = flag('loudness', 'loudness')
    if (typeof loudness === 'object') return loudness.err
    const nightMode = flag('night-mode', 'night-mode')
    if (typeof nightMode === 'object') return nightMode.err
    const speech = flag('speech', 'speech')
    if (typeof speech === 'object') return speech.err

    if (bass === undefined && treble === undefined && balance === undefined && loudness === undefined && nightMode === undefined && speech === undefined) {
      return { ok: false, kind: 'user', message: 'nothing to set — pass at least one of --bass --treble --loudness --balance --night-mode --speech', code: 'missing_arg' }
    }

    return withRoom(ctx, { pick: 'device', required: true }, async (d) => {
      const applied: Record<string, unknown> = {}
      if (bass !== undefined) {
        await d.RenderingControlService.SetBass({ InstanceID: 0, DesiredBass: bass })
        applied.bass = bass
      }
      if (treble !== undefined) {
        await d.RenderingControlService.SetTreble({ InstanceID: 0, DesiredTreble: treble })
        applied.treble = treble
      }
      if (loudness !== undefined) {
        await d.RenderingControlService.SetLoudness({ InstanceID: 0, Channel: 'Master', DesiredLoudness: loudness })
        applied.loudness = loudness
      }
      if (balance !== undefined) {
        const { lf, rf } = balanceToChannels(balance)
        await d.RenderingControlService.SetVolume({ InstanceID: 0, Channel: 'LF', DesiredVolume: lf })
        await d.RenderingControlService.SetVolume({ InstanceID: 0, Channel: 'RF', DesiredVolume: rf })
        applied.balance = balance
      }
      if (nightMode !== undefined) {
        await d.SetNightMode(nightMode)
        applied.nightMode = nightMode
      }
      if (speech !== undefined) {
        await d.SetSpeechEnhancement(speech)
        applied.speechEnhancement = speech
      }
      return { ok: true, data: { room: d.Name, applied } }
    })
  },
}
