import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { consola } from 'consola'
import { ensureConfigDirs, loadGlobalConfig, saveGlobalConfig } from '../core/config'
import { probeKeyring, selectAndPersistBackend } from '../core/secrets'
import { emit } from '../core/output'
import { paths } from '../core/paths'

const args: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
  quiet: { type: 'boolean', description: 'Suppress non-error output' },
  verbose: { type: 'boolean', description: 'Verbose debug output' },
}

export const initCmd: CommandDef = defineCommand({
  meta: { name: 'init', description: 'Initialize ~/.config/home and select the secrets backend' },
  args,
  async run({ args }) {
    const raw = args as Record<string, unknown>
    const json = Boolean(raw.json)

    ensureConfigDirs()
    const cfg = loadGlobalConfig()

    if (cfg.secretsBackend) {
      emit(
        {
          ok: true,
          data: {
            configRoot: paths.configRoot,
            secretsBackend: cfg.secretsBackend,
            status: 'already_initialized',
          },
        },
        { json },
      )
    }

    const keyringWorks = probeKeyring()
    let backend: 'keyring' | 'file' = 'keyring'
    if (!keyringWorks) {
      if (!process.stdin.isTTY) {
        emit(
          {
            ok: false,
            kind: 'system',
            message: 'no OS keyring detected and stdin is not a TTY — re-run interactively',
            code: 'no_keyring_no_tty',
          },
          { json },
        )
      }
      const accept = await consola.prompt(
        'No OS keyring available. Use mode-0600 ~/.config/home/secrets.json instead?',
        { type: 'confirm', initial: false, cancel: 'reject' },
      )
      if (!accept) {
        emit(
          {
            ok: false,
            kind: 'user',
            message: 'init aborted — install libsecret (Linux) or run on macOS, then retry',
            code: 'no_backend_chosen',
          },
          { json },
        )
      }
      backend = 'file'
    }
    selectAndPersistBackend(backend)
    saveGlobalConfig({ ...loadGlobalConfig(), secretsBackend: backend })
    emit(
      {
        ok: true,
        data: {
          configRoot: paths.configRoot,
          secretsBackend: backend,
          status: 'initialized',
        },
      },
      { json },
    )
  },
})
