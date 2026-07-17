import { existsSync, readFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join } from 'node:path'
import { UserError } from '../../core/errors'

/**
 * Where the Vercel CLI persists the token from `vercel login`. It follows the
 * platform convention rather than XDG on macOS, so the two paths differ.
 */
function authFilePaths(): string[] {
  const home = homedir()
  const xdgData = process.env.XDG_DATA_HOME || join(home, '.local', 'share')
  const paths = [join(xdgData, 'com.vercel.cli', 'auth.json')]
  if (platform() === 'darwin') {
    paths.unshift(join(home, 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'))
  }
  return paths
}

/**
 * Resolve a Vercel API token: `VERCEL_TOKEN` wins, otherwise reuse the one
 * `vercel login` already wrote. Reusing the CLI's token is what keeps
 * `vercel login` the only setup step — we never store a copy ourselves.
 */
export function resolveToken(): string {
  const fromEnv = process.env.VERCEL_TOKEN?.trim()
  if (fromEnv) return fromEnv

  for (const path of authFilePaths()) {
    if (!existsSync(path)) continue
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as { token?: string }
      if (raw.token) return raw.token
    } catch {
      // Unreadable or malformed — fall through to the next candidate.
    }
  }

  throw new UserError(
    'no Vercel token found — run `vercel login`, or set VERCEL_TOKEN',
    'vercel_no_token',
  )
}

export function hasToken(): boolean {
  try {
    resolveToken()
    return true
  } catch {
    return false
  }
}
