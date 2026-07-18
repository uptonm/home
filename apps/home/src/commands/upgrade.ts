import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { emit } from '../core/output'
import { HOME_VERSION, IS_PACKAGED } from '../core/version'
import { fetchLatestVersion, isNewerAvailable, normalizeVersion, writeCache } from '../core/update'
import { currentTarget, defaultUpgradeIO, performUpgrade } from '../core/self-install'

const args: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
  check: { type: 'boolean', description: 'Report whether an update is available; do not install' },
  yes: { type: 'boolean', description: 'Perform the upgrade (required to replace the binary)' },
  tag: { type: 'string', description: 'Install a specific release tag, e.g. v0.2.0' },
}

export const upgradeCmd: CommandDef = defineCommand({
  meta: { name: 'upgrade', description: 'Upgrade the home binary from GitHub Releases' },
  args,
  async run({ args }) {
    const raw = args as Record<string, unknown>
    const json = Boolean(raw.json)
    const check = Boolean(raw.check)
    const yes = Boolean(raw.yes)
    const rawTag = typeof raw.tag === 'string' ? raw.tag.trim() : ''
    const tag = rawTag ? (rawTag.startsWith('v') ? rawTag : `v${rawTag}`) : undefined

    if (!IS_PACKAGED) {
      await emit(
        {
          ok: false,
          kind: 'user',
          code: 'not_packaged',
          message: 'running from source — build with `bun run build:install` instead of self-upgrading',
        },
        { json },
      )
      return
    }

    const target = currentTarget()
    if (!target) {
      await emit(
        {
          ok: false,
          kind: 'system',
          code: 'unsupported_platform',
          message: `no prebuilt binary for ${process.platform}-${process.arch}`,
        },
        { json },
      )
      return
    }

    const desired = tag ? normalizeVersion(tag) : await fetchLatestVersion()
    if (!desired) {
      await emit(
        { ok: false, kind: 'system', code: 'latest_unavailable', message: 'could not determine the latest release' },
        { json },
      )
      return
    }

    const updateAvailable = isNewerAvailable(HOME_VERSION, desired)

    if (check) {
      await emit({ ok: true, data: { current: HOME_VERSION, latest: desired, updateAvailable } }, { json })
      return
    }

    // Without an explicit --tag, refuse to reinstall when already current.
    if (!tag && !updateAvailable) {
      await emit({ ok: true, data: `home is up to date (v${HOME_VERSION})` }, { json })
      return
    }

    // House convention: a binary-mutating action never prompts — it requires --yes.
    if (!yes) {
      await emit(
        {
          ok: false,
          kind: 'user',
          code: 'confirmation_required',
          message: `would upgrade home v${HOME_VERSION} → v${desired}. Re-run with --yes to install.`,
        },
        { json },
      )
      return
    }

    try {
      const result = await performUpgrade({ execPath: process.execPath, asset: target.asset, tag }, defaultUpgradeIO())
      // Refresh the cache so the preflight banner clears on the next run.
      writeCache({ latest: desired, checkedAt: Date.now() })
      await emit({ ok: true, data: { upgraded: true, from: HOME_VERSION, to: desired, path: result.path } }, { json })
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'upgrade_failed'
      await emit({ ok: false, kind: 'system', message: (err as Error).message, code }, { json })
    }
  },
})
