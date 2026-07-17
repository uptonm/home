import { accessSync, chmodSync, constants as FS, existsSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { runProcess } from './process'
import { SystemError } from './errors'
import { ghBinary, RELEASE_REPO } from './update'

export type OS = 'linux' | 'darwin'
export type Arch = 'x64' | 'arm64'

export interface Target {
  os: OS
  arch: Arch
  asset: string
}

/**
 * Map the host to its release asset, or null when no prebuilt binary exists.
 * The build matrix in .github/workflows/release-please.yml ships exactly two:
 * linux-x64 and darwin-arm64 — keep this in sync with it.
 */
export function currentTarget(platform: string = process.platform, arch: string = process.arch): Target | null {
  const os: OS | null = platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : null
  const a: Arch | null = arch === 'x64' ? 'x64' : arch === 'arm64' ? 'arm64' : null
  if (!os || !a) return null
  if (os === 'linux' && a !== 'x64') return null
  if (os === 'darwin' && a !== 'arm64') return null
  return { os, arch: a, asset: `home-${os}-${a}` }
}

export function canWrite(dir: string): boolean {
  try {
    accessSync(dir, FS.W_OK)
    return true
  } catch {
    return false
  }
}

async function download(asset: string, tag: string | undefined, dest: string): Promise<void> {
  // `gh release download` with no tag grabs the latest release; the private
  // repo is only reachable through gh's auth, so this is the only transport.
  const argv: [string, ...string[]] = [
    ghBinary(),
    'release',
    'download',
    ...(tag ? [tag] : []),
    '--repo',
    RELEASE_REPO,
    '--pattern',
    asset,
    '--output',
    dest,
    '--clobber',
  ]
  const res = await runProcess(argv, { timeoutMs: 120_000 })
  if (res.exitCode !== 0) {
    const detail = (res.stderr || res.stdout || `exit ${res.exitCode}`).trim().split('\n')[0]
    throw new SystemError(`download failed via gh: ${detail}`, 'upgrade_download_failed')
  }
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path)
  } catch {
    /* ignore */
  }
}

export interface UpgradeIO {
  download: (asset: string, tag: string | undefined, dest: string) => Promise<void>
  run: typeof runProcess
  platform: string
  canWrite: (dir: string) => boolean
}

export function defaultUpgradeIO(): UpgradeIO {
  return { download, run: runProcess, platform: process.platform, canWrite }
}

export interface UpgradeParams {
  execPath: string
  asset: string
  tag?: string
}

export interface UpgradeResult {
  path: string
}

/**
 * Download the release asset and swap it in for the running binary. Verifies
 * the downloaded binary launches on this machine *before* replacing anything,
 * so a corrupt or wrong-arch download never leaves the user without a working
 * `home`. Where the install dir is writable, the swap is an atomic rename with
 * a backup for rollback; otherwise it falls back to `sudo mv`.
 */
export async function performUpgrade(p: UpgradeParams, io: UpgradeIO): Promise<UpgradeResult> {
  const dir = dirname(p.execPath)
  const writable = io.canWrite(dir)
  const tmp = join(writable ? dir : tmpdir(), `.home-upgrade-${process.pid}`)

  await io.download(p.asset, p.tag, tmp)
  chmodSync(tmp, 0o755)

  if (io.platform === 'darwin') {
    // Ad-hoc re-sign so Gatekeeper allows the freshly downloaded binary.
    await io.run(['codesign', '--force', '--sign', '-', tmp])
  }

  const check = await io.run([tmp, '--version'])
  if (check.exitCode !== 0) {
    safeUnlink(tmp)
    throw new SystemError(`downloaded binary failed to run (exit ${check.exitCode})`, 'upgrade_verify_failed')
  }

  if (writable) {
    const backup = join(dir, '.home.bak')
    safeUnlink(backup)
    renameSync(p.execPath, backup)
    try {
      renameSync(tmp, p.execPath)
    } catch (err) {
      renameSync(backup, p.execPath)
      throw new SystemError(`failed to install new binary: ${(err as Error).message}`, 'upgrade_install_failed')
    }
    safeUnlink(backup)
  } else {
    const mv = await io.run(['sudo', 'mv', tmp, p.execPath])
    if (mv.exitCode !== 0) {
      safeUnlink(tmp)
      throw new SystemError(
        `could not replace ${p.execPath}: it is not writable and \`sudo mv\` failed`,
        'upgrade_permission_denied',
      )
    }
    // `mv` consumes the staging file on success; unlink defensively in case it didn't.
    safeUnlink(tmp)
  }

  return { path: p.execPath }
}
