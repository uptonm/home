import type { CommandSpec } from '../../../core/types'
import { readTtsConfig, synth } from '../client'

export const synthCmd: CommandSpec = {
  path: ['synth'],
  effect: 'write', // writes a local file by default — must stay out of e2e auto-reads
  description: 'Synthesize speech from text and write it to disk as an MP3 file (plays on every Sonos generation tested including S1 hardware like Play:5 Gen 1; earlier m4a and WAV outputs both failed silently on S1). Prints the path; does not play anything. Backend: macOS `say` on darwin, `espeak-ng` on linux; both pipe through `lame` so `brew install lame` / `apt install lame` is required.',
  args: [
    { name: 'text', kind: 'positional', description: 'Text to speak', required: true },
    { name: 'voice', kind: 'string', description: 'Voice name (default from config; macOS `say -v ?` for darwin, `espeak-ng --voices` for linux)' },
    { name: 'rate', kind: 'number', description: 'Words per minute (default from config; typical 150-220)' },
    { name: 'out', kind: 'string', description: 'Output path (default: a fresh tempfile)' },
  ],
  examples: [
    'home tts synth "Hello world" --json',
    'home tts synth "Dinner is ready" --voice Samantha --rate 180 --json',
    // One-shot notification: tts synth produces a tempfile, sonos notify --delete-after rms it after playback so /tmp doesn\'t accumulate.
    'FILE=$(home tts synth "Hello world" --json | jq -r .path) && home sonos notify "Living Room" --file "$FILE" --delete-after',
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
