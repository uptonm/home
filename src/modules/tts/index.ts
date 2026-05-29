import type { ModuleManifest } from '../../core/types'
import { readTtsConfig, synth } from './client'
import { synthCmd } from './commands/synth'

export const manifest: ModuleManifest = {
  name: 'tts',
  description: 'Synthesize speech to an audio file (composes with `home sonos notify` for spoken notifications)',
  whenToUse:
    'Use when the user wants to convert text into a spoken audio file — e.g. "say hello", "announce X". This module only produces a file; for playback on a Sonos speaker hand the resulting path to `home sonos notify <room> --file <path>`. Default provider is macOS `say` (no API key needed). Voice and rate can be overridden per-call with --voice and --rate.',
  configSchema: [],
  commands: [synthCmd],
  async status(cfg) {
    try {
      const result = await synth(readTtsConfig(cfg), { text: 'ok' })
      return { ok: true, data: { provider: result.provider, voice: result.voice, sampleAt: result.path } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
