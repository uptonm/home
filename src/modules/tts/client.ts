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
  const rawProvider = cfg.provider === undefined || cfg.provider === null ? 'say' : String(cfg.provider)
  if (!(TTS_PROVIDERS as readonly string[]).includes(rawProvider)) {
    throw new SystemError(`unknown tts provider: ${rawProvider} (known: ${TTS_PROVIDERS.join(', ')})`, 'unsupported_provider')
  }
  const provider = rawProvider as TtsProvider
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

/**
 * Lightweight provider-availability check used by `home tts status`. Doesn't
 * synthesize anything, doesn't leave files on disk — just confirms the
 * configured backend is reachable.
 */
export async function pingProvider(cfg: TtsConfig): Promise<void> {
  if (cfg.provider !== 'say') {
    throw new SystemError(`unsupported tts provider: ${cfg.provider}`, 'unsupported_provider')
  }
  // `say -?` exits 1 with usage on stderr; we only care whether the binary is
  // on PATH and runnable, not the exit code.
  await new Promise<void>((resolve, reject) => {
    const child = spawn('say', ['-?'], { stdio: ['ignore', 'ignore', 'ignore'] })
    child.once('error', reject)
    child.once('close', () => resolve())
  })
}
