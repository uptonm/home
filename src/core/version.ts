declare const __HOME_VERSION: string | undefined
declare const __HOME_COMMIT: string | undefined

function devVersion(): string {
  try {
    const pkg = require('../../package.json') as { version?: string }
    return pkg.version ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function devCommit(): string {
  try {
    const { execSync } = require('node:child_process') as typeof import('node:child_process')
    return execSync('git rev-parse --short HEAD', {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return 'dev'
  }
}

export const HOME_VERSION: string = typeof __HOME_VERSION !== 'undefined' ? __HOME_VERSION : devVersion()
export const HOME_COMMIT: string = typeof __HOME_COMMIT !== 'undefined' ? __HOME_COMMIT : devCommit()
