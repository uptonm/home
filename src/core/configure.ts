import { consola } from 'consola'
import { CURRENT_MODULE_SCHEMA, loadModuleConfig, saveModuleConfig, type ModuleConfigData } from './config'
import { getSecret, setSecret } from './secrets'
import type { ConfigField, ModuleConfig, ModuleManifest } from './types'
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

async function promptText(label: string, initial: string | undefined): Promise<string> {
  return consola.prompt(label, {
    type: 'text',
    default: initial ?? '',
    cancel: 'reject',
  })
}

async function promptConfirm(label: string, initial: boolean | undefined): Promise<boolean> {
  return consola.prompt(label, {
    type: 'confirm',
    initial: initial ?? false,
    cancel: 'reject',
  })
}

async function promptSelect(label: string, options: readonly string[], initial: string | undefined): Promise<string> {
  return consola.prompt(label, {
    type: 'select',
    options: [...options],
    initial,
    cancel: 'reject',
  }) as Promise<string>
}

async function promptField(field: ConfigField, current: string | boolean | undefined): Promise<string | boolean> {
  while (true) {
    let answer: string | boolean
    if (field.kind === 'boolean') {
      answer = await promptConfirm(field.label, (current as boolean | undefined) ?? (field.default as boolean | undefined))
    } else if (field.kind === 'enum') {
      const initial = (current as string | undefined) ?? (field.default as string | undefined)
      answer = await promptSelect(field.label, field.enum ?? [], initial)
    } else {
      const initial = (current as string | undefined) ?? (field.default as string | undefined)
      if (field.kind === 'secret' && initial) {
        consola.info('(existing secret will be kept if you leave this blank)')
      }
      const text = await promptText(field.label + (field.help ? ` — ${field.help}` : ''), initial)
      if (field.kind === 'secret' && text.trim() === '' && initial) {
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
        answer = await promptField(field, current)
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
