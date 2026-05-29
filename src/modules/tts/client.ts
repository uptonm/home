import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { SystemError } from '../../core/errors'
import type { ModuleConfig } from '../../core/types'

export type TtsProvider = 'say' | 'espeak-ng'

export const TTS_PROVIDERS: readonly TtsProvider[] = ['say', 'espeak-ng'] as const

/** Picks the default backend for the current platform. */
function defaultProvider(): TtsProvider {
  return process.platform === 'darwin' ? 'say' : 'espeak-ng'
}

/** Defaults are per-provider — macOS `say` voice names don't map to espeak-ng. */
function defaultVoice(provider: TtsProvider): string {
  return provider === 'say' ? 'Samantha' : 'en'
}

const DEFAULT_RATE = 175

export interface TtsConfig {
  provider: TtsProvider
  voice: string
  rate: number
}

export function readTtsConfig(cfg: ModuleConfig): TtsConfig {
  const rawProvider = cfg.provider === undefined || cfg.provider === null ? defaultProvider() : String(cfg.provider)
  if (!(TTS_PROVIDERS as readonly string[]).includes(rawProvider)) {
    throw new SystemError(`unknown tts provider: ${rawProvider} (known: ${TTS_PROVIDERS.join(', ')})`, 'unsupported_provider')
  }
  const provider = rawProvider as TtsProvider
  const voice = String(cfg.voice ?? defaultVoice(provider))
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
  format: 'mp3'
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

async function commandAvailable(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn('which', [cmd], { stdio: ['ignore', 'ignore', 'ignore'] })
    child.once('error', () => resolve(false))
    child.once('close', (code) => resolve(code === 0))
  })
}

interface ProviderPipeline {
  binary: string
  /** Build the command that writes intermediate audio (AIFF or WAV) to `intermediatePath`. */
  args(opts: { voice: string; rate: number; text: string; intermediatePath: string }): string[]
  /** Extension for the intermediate file (`.aiff` on macOS, `.wav` on Linux). */
  intermediateExt: '.aiff' | '.wav'
}

function pipelineFor(provider: TtsProvider): ProviderPipeline {
  if (provider === 'say') {
    return {
      binary: 'say',
      intermediateExt: '.aiff',
      args: ({ voice, rate, text, intermediatePath }) => ['-v', voice, '-r', String(rate), '-o', intermediatePath, text],
    }
  }
  return {
    binary: 'espeak-ng',
    intermediateExt: '.wav',
    args: ({ voice, rate, text, intermediatePath }) => ['-v', voice, '-s', String(rate), '-w', intermediatePath, text],
  }
}

/**
 * Synthesize speech to an MP3 on disk.
 *
 * Earlier iterations of this module emitted m4a (AAC-in-MP4) — fails on S1
 * hardware like the Play:5 Gen 1, which doesn't decode AAC reliably. Then
 * 16-bit PCM WAV — *also* fails on S1 when served from our ephemeral Bun
 * HTTP server (the same speaker plays a public-URL WAV fine via
 * `notify --url`, so something about our headers or the WAV byte layout
 * trips the firmware). MP3 plays cleanly across every Sonos generation we
 * tested and is the lowest-friction known-good format.
 *
 * Pipeline:
 *   - macOS:  `say` → AIFF → `lame` → MP3
 *   - Linux:  `espeak-ng` → WAV → `lame` → MP3
 *
 * Requires `lame` on PATH on both platforms (`brew install lame` /
 * `apt install lame`), plus the platform-native synthesizer (`say` is
 * built-in on macOS; `apt install espeak-ng` on Debian/Ubuntu). Adds
 * ~80 ms vs a direct-WAV pipeline; the audio is consumed by a LAN
 * speaker so quality difference vs lossless is inaudible.
 */
export async function synth(cfg: TtsConfig, opts: SynthOptions): Promise<SynthResult> {
  if (!opts.text || !opts.text.trim()) {
    throw new SystemError('text is empty', 'empty_text')
  }
  const pipeline = pipelineFor(cfg.provider)
  if (!(await commandAvailable(pipeline.binary))) {
    throw new SystemError(missingBinaryMessage(pipeline.binary), `${pipeline.binary.replace(/-/g, '_')}_missing`)
  }
  if (!(await commandAvailable('lame'))) {
    throw new SystemError(missingBinaryMessage('lame'), 'lame_missing')
  }
  const voice = opts.voice ?? cfg.voice
  const rate = opts.rate ?? cfg.rate

  let outPath: string
  let cleanupDir: string | null = null
  if (opts.outPath) {
    outPath = opts.outPath
  } else {
    const dir = mkdtempSync(join(tmpdir(), 'home-tts-'))
    cleanupDir = dir
    outPath = join(dir, `${randomBytes(6).toString('hex')}.mp3`)
  }

  const intermediatePath = `${outPath}${pipeline.intermediateExt}`
  const synthResult = await runCommand(pipeline.binary, pipeline.args({ voice, rate, text: opts.text, intermediatePath }))
  if (synthResult.code !== 0) {
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true })
    throw new SystemError(
      `\`${pipeline.binary}\` exited ${synthResult.code}${synthResult.stderr ? `: ${synthResult.stderr.trim().slice(0, 200)}` : ''}`,
      `${pipeline.binary.replace(/-/g, '_')}_failed`,
    )
  }
  if (!existsSync(intermediatePath)) {
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true })
    throw new SystemError(`\`${pipeline.binary}\` reported success but produced no file at ${intermediatePath}`, `${pipeline.binary.replace(/-/g, '_')}_no_output`)
  }

  const lameResult = await runCommand('lame', ['--quiet', '-V', '2', intermediatePath, outPath])
  // Always remove the intermediate — we only want the MP3 to survive.
  rmSync(intermediatePath, { force: true })
  if (lameResult.code !== 0) {
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true })
    throw new SystemError(
      `\`lame\` exited ${lameResult.code}${lameResult.stderr ? `: ${lameResult.stderr.trim().slice(0, 200)}` : ''}`,
      'lame_failed',
    )
  }
  if (!existsSync(outPath)) {
    if (cleanupDir) rmSync(cleanupDir, { recursive: true, force: true })
    throw new SystemError(`\`lame\` reported success but produced no file at ${outPath}`, 'lame_no_output')
  }
  return { path: outPath, provider: cfg.provider, voice, rate, format: 'mp3' }
}

function missingBinaryMessage(binary: string): string {
  if (binary === 'say') return 'macOS `say` is not on PATH (only available on macOS)'
  if (binary === 'espeak-ng') return '`espeak-ng` is not on PATH — install with `apt install espeak-ng` (Debian/Ubuntu)'
  if (binary === 'lame') return '`lame` is not on PATH — install with `brew install lame` (macOS) or `apt install lame` (Debian/Ubuntu)'
  return `\`${binary}\` is not on PATH`
}

/**
 * Lightweight provider-availability check used by `home tts status`. Doesn't
 * synthesize anything, doesn't leave files on disk — just confirms the
 * configured backend and its transcoder are reachable.
 */
export async function pingProvider(cfg: TtsConfig): Promise<void> {
  const pipeline = pipelineFor(cfg.provider)
  if (!(await commandAvailable(pipeline.binary))) {
    throw new SystemError(missingBinaryMessage(pipeline.binary), `${pipeline.binary.replace(/-/g, '_')}_missing`)
  }
  if (!(await commandAvailable('lame'))) {
    throw new SystemError(missingBinaryMessage('lame'), 'lame_missing')
  }
}
