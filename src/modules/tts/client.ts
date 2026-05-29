import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { SystemError } from '../../core/errors'
import type { ModuleConfig } from '../../core/types'

export type TtsProvider = 'say'

export const TTS_PROVIDERS: readonly TtsProvider[] = ['say'] as const

export interface TtsConfig {
  provider: TtsProvider
  voice: string
  rate: number
}

const DEFAULT_VOICE = 'Samantha'
const DEFAULT_RATE = 175

export function readTtsConfig(cfg: ModuleConfig): TtsConfig {
  const provider = (cfg.provider as TtsProvider | undefined) ?? 'say'
  const voice = String(cfg.voice ?? DEFAULT_VOICE)
  const rateRaw = Number(cfg.rate)
  const rate = Number.isFinite(rateRaw) && rateRaw > 0 ? Math.round(rateRaw) : DEFAULT_RATE
  return { provider, voice, rate }
}

export interface SynthOptions {
  text: string
  voice?: string
  rate?: number
  outPath?: string
}

export interface SynthResult {
  path: string
  provider: TtsProvider
  voice: string
  rate: number
  format: 'wav'
}

function runCommand(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', (code) => resolve({ code: code ?? -1, stderr }))
  })
}

/**
 * Synthesize via macOS `say`. The output is uncompressed 16-bit PCM WAV at
 * 22 kHz mono — works on every Sonos generation, including S1 hardware like
 * the Play:5 Gen 1 which doesn't decode AAC-in-MP4 reliably. File size is
 * ~44 KB/s of speech, which is fine for LAN-served notifications.
 */
export async function synth(cfg: TtsConfig, opts: SynthOptions): Promise<SynthResult> {
  if (cfg.provider !== 'say') {
    throw new SystemError(`unsupported tts provider: ${cfg.provider}`, 'unsupported_provider')
  }
  if (!opts.text || !opts.text.trim()) {
    throw new SystemError('text is empty', 'empty_text')
  }
  const voice = opts.voice ?? cfg.voice
  const rate = opts.rate ?? cfg.rate

  let outPath: string
  if (opts.outPath) {
    outPath = opts.outPath
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'home-tts-'))
    outPath = join(dir, `${randomBytes(6).toString('hex')}.wav`)
  }

  const args = [
    '-v', voice,
    '-r', String(rate),
    '-o', outPath,
    '--file-format=WAVE',
    '--data-format=LEI16@22050',
    opts.text,
  ]
  const { code, stderr } = await runCommand('say', args)
  if (code !== 0) {
    throw new SystemError(`\`say\` exited ${code}${stderr ? `: ${stderr.trim().slice(0, 200)}` : ''}`, 'say_failed')
  }
  if (!existsSync(outPath)) {
    throw new SystemError(`\`say\` reported success but produced no file at ${outPath}`, 'say_no_output')
  }
  return { path: outPath, provider: 'say', voice, rate, format: 'wav' }
}

/** List the macOS voices available to `say`. Used by configure prompts. */
export async function listSayVoices(): Promise<{ name: string; locale: string; sample: string }[]> {
  return new Promise((resolve, reject) => {
    const child = spawn('say', ['-v', '?'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.once('error', reject)
    child.once('close', () => {
      const voices = stdout
        .split('\n')
        .map((line) => line.match(/^(\S+)\s+(\S+)\s+#\s+(.*)$/))
        .filter((m): m is RegExpMatchArray => !!m)
        .map((m) => ({ name: m[1]!, locale: m[2]!, sample: m[3]! }))
      resolve(voices)
    })
  })
}
