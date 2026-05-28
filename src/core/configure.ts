import { consola } from 'consola'
import { CURRENT_MODULE_SCHEMA, loadModuleConfig, saveModuleConfig, type ModuleConfigData } from './config'
import { getSecret, setSecret } from './secrets'
import type { ConfigField, DynamicEnumOption, ModuleConfig, ModuleManifest } from './types'
import { UserError } from './errors'

export interface ConfigureOpts {
  rotate?: boolean
  force?: boolean
}

function defaultUrlValidator(v: string): string | null {
  try {
    new URL(v)
    return null
  } catch {
    return 'invalid URL'
  }
}

function validatorFor(field: ConfigField): (v: string) => string | null {
  const custom = field.validate
  if (field.kind === 'url') {
    return (v) => defaultUrlValidator(v) ?? (custom ? custom(v) : null)
  }
  return custom ?? (() => null)
}

async function promptText(
  label: string,
  initial: string | undefined,
  opts: { showDefault?: boolean; placeholder?: string } = {},
): Promise<string> {
  const showDefault = opts.showDefault !== false
  const promptOpts: {
    type: 'text'
    default?: string
    placeholder?: string
    cancel: 'reject'
  } = { type: 'text', cancel: 'reject' }
  if (initial && showDefault) {
    promptOpts.default = initial
    promptOpts.placeholder = initial
  } else if (opts.placeholder) {
    promptOpts.placeholder = opts.placeholder
  }
  return consola.prompt(label, promptOpts)
}

const ANSI = {
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  gray: (s: string) => `\x1b[90m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[22m`,
}

async function promptPassword(label: string, hint?: string): Promise<string> {
  if (!process.stdin.isTTY) {
    return promptText(label + (hint ? ` (${hint})` : ''), undefined)
  }
  return new Promise<string>((resolve, reject) => {
    process.stderr.write(`${ANSI.gray('│')}\n`)
    process.stderr.write(`${ANSI.cyan('◇')}  ${label}\n`)
    if (hint) process.stderr.write(`${ANSI.gray('│')}  ${ANSI.dim(hint)}\n`)
    process.stderr.write(`${ANSI.cyan('│')}  `)

    process.stdin.setRawMode(true)
    process.stdin.resume()
    let buf = ''

    const cleanup = () => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
    }

    const onData = (chunk: Buffer) => {
      const s = chunk.toString('utf8')
      for (const ch of s) {
        if (ch === '\r' || ch === '\n') {
          cleanup()
          process.stderr.write(`\n${ANSI.gray('└')}\n`)
          resolve(buf)
          return
        }
        if (ch === '\x7f' || ch === '\b') {
          if (buf.length > 0) {
            buf = buf.slice(0, -1)
            process.stderr.write('\b \b')
          }
          continue
        }
        if (ch === '\x03') {
          cleanup()
          process.stderr.write('\n')
          reject(new Error('Prompt cancelled.'))
          return
        }
        if (ch < ' ') continue
        buf += ch
        process.stderr.write('•')
      }
    }
    process.stdin.on('data', onData)
  })
}

async function promptConfirm(label: string, initial: boolean | undefined): Promise<boolean> {
  return consola.prompt(label, {
    type: 'confirm',
    initial: initial ?? false,
    cancel: 'reject',
  })
}

async function promptSelect(
  label: string,
  options: readonly DynamicEnumOption[],
  initial: string | undefined,
): Promise<string> {
  return consola.prompt(label, {
    type: 'select',
    options: options.map((o) =>
      typeof o === 'string' ? o : { value: o.value, label: o.label ?? o.value, hint: o.hint ?? '' },
    ),
    initial,
    cancel: 'reject',
  }) as Promise<string>
}

function resolveDefault(field: ConfigField): string | boolean | undefined {
  if (field.default === undefined) return undefined
  if (typeof field.default === 'function') {
    try {
      return field.default()
    } catch {
      return undefined
    }
  }
  return field.default
}

async function promptField(
  field: ConfigField,
  current: string | boolean | undefined,
  partial: ModuleConfig,
): Promise<string | boolean> {
  while (true) {
    let answer: string | boolean
    const fieldDefault = resolveDefault(field)
    if (field.kind === 'boolean') {
      answer = await promptConfirm(field.label, (current as boolean | undefined) ?? (fieldDefault as boolean | undefined))
    } else if (field.kind === 'enum') {
      const initial = (current as string | undefined) ?? (fieldDefault as string | undefined)
      let options: readonly DynamicEnumOption[] = field.enum ?? []
      if (field.dynamicEnum) {
        try {
          options = await field.dynamicEnum(partial)
        } catch (err) {
          consola.warn(`could not fetch options for "${field.label}": ${(err as Error).message}`)
        }
      }
      if (options.length === 0) {
        const text = await promptText(field.label + ' (free text — could not fetch options)', initial)
        answer = text
      } else {
        answer = await promptSelect(field.label, options, initial)
      }
    } else {
      const initial = (current as string | undefined) ?? (fieldDefault as string | undefined)
      const isSecret = field.kind === 'secret'
      const label = field.label
      const hint = field.help
      let text: string
      if (isSecret) {
        const secretHint = initial ? 'press enter to keep current' : hint
        text = await promptPassword(label, secretHint)
      } else {
        text = await promptText(label + (hint ? ` — ${hint}` : ''), initial, {
          showDefault: true,
        })
      }
      if (isSecret && text.trim() === '' && initial) {
        return initial
      }
      const err = validatorFor(field)(text)
      if (err) {
        consola.error(err)
        continue
      }
      answer = text
    }
    return answer
  }
}

export async function runConfigure(manifest: ModuleManifest, opts: ConfigureOpts = {}): Promise<void> {
  const existing = (loadModuleConfig(manifest.name) ?? { $schemaVersion: CURRENT_MODULE_SCHEMA }) as ModuleConfigData
  const next: ModuleConfigData = { $schemaVersion: CURRENT_MODULE_SCHEMA }
  const secretsToSet: Record<string, string> = {}
  const probeConfig: ModuleConfig = {}

  let attempts = 0
  const maxRetries = 1

  while (true) {
    for (const field of manifest.configSchema) {
      const isSecret = field.kind === 'secret'
      if (opts.rotate && !isSecret) {
        const keep = existing[field.key]
        if (keep !== undefined) {
          next[field.key] = keep
          probeConfig[field.key] = keep
        }
        continue
      }
      const current = opts.force
        ? undefined
        : isSecret
          ? (getSecret(manifest.name, field.key) ?? undefined)
          : (existing[field.key] as string | boolean | undefined)
      let answer: string | boolean
      try {
        answer = await promptField(field, current, probeConfig)
      } catch (err) {
        if (err instanceof Error && err.message.toLowerCase().includes('cancel')) {
          throw new UserError('configure cancelled', 'cancelled')
        }
        throw err
      }
      if (isSecret) {
        const str = String(answer)
        if (str.length > 0) secretsToSet[field.key] = str
        probeConfig[field.key] = str
      } else {
        next[field.key] = answer as string | boolean
        probeConfig[field.key] = answer
      }
    }

    const probeErrors: string[] = []
    for (const field of manifest.configSchema) {
      if (!field.probe) continue
      try {
        const err = await field.probe(probeConfig)
        if (err) probeErrors.push(`${field.label}: ${err}`)
      } catch (err) {
        probeErrors.push(`${field.label}: ${(err as Error).message}`)
      }
    }

    if (probeErrors.length === 0) break

    consola.warn('probe failures:')
    for (const e of probeErrors) consola.warn(`  • ${e}`)
    const proceed = await promptConfirm('Save anyway and run status later?', false)
    if (proceed) break
    if (++attempts > maxRetries) {
      throw new UserError('configure aborted after probe failures', 'probe_failed')
    }
    consola.info('Re-running configure flow.')
  }

  saveModuleConfig(manifest.name, next)
  for (const [key, value] of Object.entries(secretsToSet)) {
    setSecret(manifest.name, key, value)
  }
  consola.success(`${manifest.name}: configuration saved`)
}
