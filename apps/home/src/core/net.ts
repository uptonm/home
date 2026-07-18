import { execSync } from 'node:child_process'

const SILENT = { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] } as const satisfies Parameters<typeof execSync>[1]

export function defaultControllerUrl(): string {
  const gw = getDefaultGateway()
  return gw ? `https://${gw}` : 'https://192.168.1.1'
}

export function getDefaultGateway(): string | null {
  try {
    if (process.platform === 'darwin') {
      const out = execSync('route -n get default', SILENT)
      return /gateway:\s+(\S+)/.exec(out)?.[1] ?? null
    }
    if (process.platform === 'linux') {
      try {
        const out = execSync('ip route show default', SILENT)
        return /default via (\S+)/.exec(out)?.[1] ?? null
      } catch {
        const out = execSync('route -n', SILENT)
        for (const line of out.split('\n')) {
          if (line.startsWith('0.0.0.0')) return line.split(/\s+/)[1] ?? null
        }
        return null
      }
    }
    if (process.platform === 'win32') {
      const out = execSync('route print 0.0.0.0', SILENT)
      const match = /0\.0\.0\.0\s+0\.0\.0\.0\s+(\S+)/.exec(out)
      return match?.[1] ?? null
    }
  } catch {
    /* fall through */
  }
  return null
}
