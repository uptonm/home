import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProcessResult } from '../core/process'
import { currentTarget, performUpgrade, type UpgradeIO } from '../core/self-install'

describe('currentTarget', () => {
  test('maps the two built targets', () => {
    expect(currentTarget('linux', 'x64')).toEqual({ os: 'linux', arch: 'x64', asset: 'home-linux-x64' })
    expect(currentTarget('darwin', 'arm64')).toEqual({ os: 'darwin', arch: 'arm64', asset: 'home-darwin-arm64' })
  })

  test('returns null for targets with no prebuilt binary', () => {
    expect(currentTarget('linux', 'arm64')).toBeNull()
    expect(currentTarget('darwin', 'x64')).toBeNull()
    expect(currentTarget('win32', 'x64')).toBeNull()
  })
})

function procResult(exitCode: number | null): ProcessResult {
  return {
    stdout: '',
    stderr: '',
    exitCode,
    signal: null,
    timedOut: false,
    stdoutTruncated: false,
    stderrTruncated: false,
  }
}

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function scratch(): string {
  const d = mkdtempSync(join(tmpdir(), 'home-upgrade-test-'))
  dirs.push(d)
  return d
}

interface FakeIO extends UpgradeIO {
  calls: string[][]
}

function fakeIO(overrides: Partial<UpgradeIO> & { verifyExit?: number } = {}): FakeIO {
  const calls: string[][] = []
  return {
    calls,
    platform: overrides.platform ?? 'linux',
    canWrite: overrides.canWrite ?? (() => true),
    download:
      overrides.download ??
      (async (_asset, _tag, dest) => {
        writeFileSync(dest, 'NEW_BINARY')
      }),
    run:
      overrides.run ??
      (async (argv) => {
        calls.push([...argv])
        // The verify step is `<tmp> --version`; everything else (codesign, mv) succeeds.
        if (argv[1] === '--version') return procResult(overrides.verifyExit ?? 0)
        return procResult(0)
      }),
  }
}

describe('performUpgrade', () => {
  test('writable dir: atomically swaps in the new binary and cleans up', async () => {
    const dir = scratch()
    const execPath = join(dir, 'home')
    writeFileSync(execPath, 'OLD_BINARY')
    const io = fakeIO()

    const result = await performUpgrade({ execPath, asset: 'home-linux-x64' }, io)

    expect(result.path).toBe(execPath)
    expect(readFileSync(execPath, 'utf8')).toBe('NEW_BINARY')
    expect(existsSync(join(dir, '.home.bak'))).toBe(false)
    expect(existsSync(join(dir, `.home-upgrade-${process.pid}`))).toBe(false)
  })

  test('verification failure leaves the current binary untouched', async () => {
    const dir = scratch()
    const execPath = join(dir, 'home')
    writeFileSync(execPath, 'OLD_BINARY')
    const io = fakeIO({ verifyExit: 1 })

    await expect(performUpgrade({ execPath, asset: 'home-linux-x64' }, io)).rejects.toMatchObject({
      code: 'upgrade_verify_failed',
    })
    expect(readFileSync(execPath, 'utf8')).toBe('OLD_BINARY')
  })

  test('darwin ad-hoc re-signs the download before verifying', async () => {
    const dir = scratch()
    const execPath = join(dir, 'home')
    writeFileSync(execPath, 'OLD_BINARY')
    const io = fakeIO({ platform: 'darwin' })

    await performUpgrade({ execPath, asset: 'home-darwin-arm64' }, io)

    const codesign = io.calls.find((c) => c[0] === 'codesign')
    expect(codesign).toBeDefined()
    expect(codesign).toEqual(['codesign', '--force', '--sign', '-', join(dir, `.home-upgrade-${process.pid}`)])
  })

  test('non-writable dir falls back to sudo mv', async () => {
    const dir = scratch()
    const execPath = join(dir, 'home')
    writeFileSync(execPath, 'OLD_BINARY')
    const io = fakeIO({ canWrite: () => false })

    await performUpgrade({ execPath, asset: 'home-linux-x64' }, io)

    const mv = io.calls.find((c) => c[0] === 'sudo')
    expect(mv).toBeDefined()
    expect(mv?.slice(0, 2)).toEqual(['sudo', 'mv'])
    expect(mv?.[3]).toBe(execPath)
  })
})
