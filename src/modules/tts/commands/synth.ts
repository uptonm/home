import type { CommandSpec } from '../../../core/types'
import { readTtsConfig, synth } from '../client'

export const synthCmd: CommandSpec = {
  path: ['synth'],
  description: 'Synthesize speech from text and write it to disk as m4a. Prints the path; does not play anything.',
  args: [
    { name: 'text', kind: 'positional', description: 'Text to speak', required: true },
    { name: 'voice', kind: 'string', description: 'Voice name (default from config; macOS `say -v ?` for the list)' },
    { name: 'rate', kind: 'number', description: 'Words per minute (default from config; typical 150-220)' },
    { name: 'out', kind: 'string', description: 'Output path (default: a fresh tempfile)' },
  ],
  examples: [
    'home tts synth "Hello world" --json',
    'home tts synth "Dinner is ready" --voice Samantha --rate 180 --json',
    'FILE=$(home tts synth "Hello world" --json | jq -r .path) && home sonos notify "Living Room" --file "$FILE"',
  ],
  async run(ctx) {
    const text = String(ctx.args.text ?? '').trim()
    if (!text) return { ok: false, kind: 'user', message: 'text is required', code: 'missing_arg' }
    const cfg = readTtsConfig(ctx.config)
    const result = await synth(cfg, {
      text,
      voice: ctx.args.voice ? String(ctx.args.voice) : undefined,
      rate: ctx.args.rate !== undefined ? Number(ctx.args.rate) : undefined,
      outPath: ctx.args.out ? String(ctx.args.out) : undefined,
    })
    return { ok: true, data: result }
  },
}
