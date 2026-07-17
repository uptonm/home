import type { Scenario, ScenarioCtx } from '../scenario'

const room = (ctx: ScenarioCtx) => ctx.fixtures.sonosRoom

function field(json: unknown, key: string): unknown {
  return (json as Record<string, unknown> | null)?.[key]
}

export const sonosScenarios: Scenario[] = [
  {
    name: 'volume-round-trip',
    module: 'sonos',
    async run(ctx) {
      const before = await ctx.cli('sonos', ['volume', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'volume get failed')
      const original = Number(field(before.json, 'volume'))
      ctx.check(Number.isFinite(original), 'volume get returned no volume')
      ctx.defer(async () => {
        await ctx.cli('sonos', ['volume', 'set'], [room(ctx), String(original)])
      })
      const target = original === 17 ? 18 : 17
      const set = await ctx.cli('sonos', ['volume', 'set'], [room(ctx), String(target)])
      ctx.check(set.exitCode === 0, 'volume set failed')
      const after = await ctx.cli('sonos', ['volume', 'get'], [room(ctx)])
      ctx.check(Number(field(after.json, 'volume')) === target, `expected volume ${target}`)
    },
  },
  {
    name: 'mute-cycle',
    module: 'sonos',
    async run(ctx) {
      // ends unmuted; acceptable perturbation on the test speaker
      const on = await ctx.cli('sonos', ['mute'], [room(ctx), '--state', 'on'])
      ctx.check(on.exitCode === 0, 'mute on failed')
      const off = await ctx.cli('sonos', ['mute'], [room(ctx), '--state', 'off'])
      ctx.check(off.exitCode === 0, 'mute off failed')
    },
  },
  {
    name: 'play-mode-round-trip',
    module: 'sonos',
    async run(ctx) {
      const before = await ctx.cli('sonos', ['play-mode', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'play-mode get failed')
      const shuffle = String(field(before.json, 'shuffle'))
      const original = shuffle === 'true' || shuffle === 'on' ? 'on' : 'off'
      ctx.defer(async () => {
        await ctx.cli('sonos', ['play-mode', 'set'], [room(ctx), '--shuffle', original])
      })
      const flipped = original === 'on' ? 'off' : 'on'
      const set = await ctx.cli('sonos', ['play-mode', 'set'], [room(ctx), '--shuffle', flipped])
      ctx.check(set.exitCode === 0, 'play-mode set failed')
      const after = await ctx.cli('sonos', ['play-mode', 'get'], [room(ctx)])
      const now = String(field(after.json, 'shuffle'))
      ctx.check((now === 'true' || now === 'on') === (flipped === 'on'), `expected shuffle ${flipped}`)
    },
  },
  {
    name: 'eq-bass-round-trip',
    module: 'sonos',
    async run(ctx) {
      const before = await ctx.cli('sonos', ['eq', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'eq get failed')
      const original = Number(field(before.json, 'bass'))
      ctx.check(Number.isFinite(original), 'eq get returned no bass')
      ctx.defer(async () => {
        await ctx.cli('sonos', ['eq', 'set'], [room(ctx), '--bass', String(original)])
      })
      const target = original >= 10 ? original - 1 : original + 1
      const set = await ctx.cli('sonos', ['eq', 'set'], [room(ctx), '--bass', String(target)])
      ctx.check(set.exitCode === 0, 'eq set failed')
      const after = await ctx.cli('sonos', ['eq', 'get'], [room(ctx)])
      ctx.check(Number(field(after.json, 'bass')) === target, `expected bass ${target}`)
    },
  },
  {
    name: 'group-volume-round-trip',
    module: 'sonos',
    async run(ctx) {
      const before = await ctx.cli('sonos', ['group-volume', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'group-volume get failed')
      const original = Number(field(before.json, 'volume'))
      ctx.check(Number.isFinite(original), 'group-volume get returned no volume')
      ctx.defer(async () => {
        await ctx.cli('sonos', ['group-volume', 'set'], [room(ctx), String(original)])
      })
      const target = original === 15 ? 16 : 15
      const set = await ctx.cli('sonos', ['group-volume', 'set'], [room(ctx), String(target)])
      ctx.check(set.exitCode === 0, 'group-volume set failed')
    },
  },
  {
    name: 'pause-play-round-trip',
    module: 'sonos',
    async run(ctx) {
      const np = await ctx.cli('sonos', ['now-playing'], [room(ctx)])
      ctx.check(np.exitCode === 0, 'now-playing failed')
      const row = Array.isArray(np.json) ? np.json[0] : np.json
      const state = String(field(row, 'state') ?? '')
      if (!/playing/i.test(state)) return // nothing playing: only exercised when restore is possible
      const pause = await ctx.cli('sonos', ['pause'], [room(ctx)])
      ctx.check(pause.exitCode === 0, 'pause failed')
      const play = await ctx.cli('sonos', ['play'], [room(ctx)])
      ctx.check(play.exitCode === 0, 'play (restore) failed')
    },
  },
  {
    name: 'group-join-leave',
    module: 'sonos',
    async run(ctx) {
      // join test speaker to the second room's group, then leave — ends solo either way
      ctx.defer(async () => {
        await ctx.cli('sonos', ['groups', 'leave'], [room(ctx)])
      })
      const join = await ctx.cli('sonos', ['groups', 'join'], [room(ctx), ctx.fixtures.sonosSecondRoom])
      ctx.check(join.exitCode === 0, 'groups join failed')
      const leave = await ctx.cli('sonos', ['groups', 'leave'], [room(ctx)])
      ctx.check(leave.exitCode === 0, 'groups leave failed')
    },
  },
  {
    name: 'tts-notify',
    module: 'sonos',
    async run(ctx) {
      const synth = await ctx.cli('tts', ['synth'], ['e2e harness test'])
      ctx.check(synth.exitCode === 0, 'tts synth failed')
      const file = String(field(synth.json, 'path') ?? '')
      ctx.check(file.length > 0, 'tts synth returned no path')
      const notify = await ctx.cli(
        'sonos',
        ['notify'],
        [room(ctx), '--file', file, '--volume', '15', '--delete-after'],
        { timeoutMs: 60_000 },
      )
      ctx.check(notify.exitCode === 0, 'notify failed')
    },
  },
]
