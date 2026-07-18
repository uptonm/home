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
        await ctx.cliOk('sonos', ['volume', 'set'], [room(ctx), String(original)])
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
      // Snapshot the real state first — forcing "unmuted" at the end would
      // change the house whenever the speaker was deliberately muted.
      const before = await ctx.cli('sonos', ['groups', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'groups get failed')
      const members = field(before.json, 'members')
      const me = (Array.isArray(members) ? members : []).find(
        (m) => String(field(m, 'name')).toLowerCase() === room(ctx).toLowerCase(),
      )
      const original = field(me, 'muted')
      ctx.check(typeof original === 'boolean', 'could not determine current mute state')
      ctx.defer(async () => {
        await ctx.cliOk('sonos', ['mute'], [room(ctx), '--state', original ? 'on' : 'off'])
      })
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
        await ctx.cliOk('sonos', ['play-mode', 'set'], [room(ctx), '--shuffle', original])
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
        await ctx.cliOk('sonos', ['eq', 'set'], [room(ctx), '--bass', String(original)])
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
        await ctx.cliOk('sonos', ['group-volume', 'set'], [room(ctx), String(original)])
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
      // Register the resume BEFORE pausing: if the pause path throws midway,
      // the deferred play still runs and the music comes back.
      ctx.defer(async () => {
        await ctx.cliOk('sonos', ['play'], [room(ctx)])
      })
      const pause = await ctx.cli('sonos', ['pause'], [room(ctx)])
      ctx.check(pause.exitCode === 0, 'pause failed')
    },
  },
  {
    name: 'group-join-leave',
    module: 'sonos',
    async run(ctx) {
      // Snapshot topology first: blindly ending standalone would permanently
      // change the house whenever the speaker started grouped.
      const before = await ctx.cli('sonos', ['groups', 'get'], [room(ctx)])
      ctx.check(before.exitCode === 0, 'groups get failed')
      const coordinator = String(field(before.json, 'coordinator') ?? '')
      const members = field(before.json, 'members')
      const memberCount = Array.isArray(members) ? members.length : 0
      const isSelfCoordinator = coordinator.toLowerCase() === room(ctx).toLowerCase()

      if (memberCount > 1 && isSelfCoordinator) {
        // The test speaker coordinates a group with other members; leaving
        // would strand them and the original topology can't be reconstructed
        // from this side. Skip rather than perturb.
        return
      }

      if (memberCount > 1) {
        // Member of someone else's group — restore that exact membership.
        ctx.defer(async () => {
          await ctx.cliOk('sonos', ['groups', 'join'], [room(ctx), coordinator])
        })
      } else {
        // Started standalone — make sure it ends standalone.
        ctx.defer(async () => {
          await ctx.cliOk('sonos', ['groups', 'leave'], [room(ctx)])
        })
      }

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
