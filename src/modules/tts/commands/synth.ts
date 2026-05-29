import type { CommandSpec } from '../../../core/types'
import { readTtsConfig, synth } from '../client'

export const synthCmd: CommandSpec = {
  path: ['synth'],
  description: 'Synthesize speech from text and write it to disk as a 16-bit PCM WAV file (works on every Sonos generation, including S1 hardware like Play:5 Gen 1 that does not decode AAC-in-MP4 reliably). Prints the path; does not play anything.',
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
    const cfg = readTtsConfig(ctx.config)
    const result = await synth(cfg, {
      text: String(ctx.args.text ?? ''),
      voice: ctx.args.voice ? String(ctx.args.voice) : undefined,
      rate: ctx.args.rate !== undefined ? Number(ctx.args.rate) : undefined,
      outPath: ctx.args.out ? String(ctx.args.out) : undefined,
    })
    return { ok: true, data: result }
  },
}
