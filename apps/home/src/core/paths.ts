import { homedir } from 'node:os'
import { join } from 'node:path'

// Every path below re-reads XDG_CONFIG_HOME/homedir() on each access rather
// than closing over a value resolved once at import time. Tests set
// XDG_CONFIG_HOME to a throwaway dir before writing config/secrets; if these
// were precomputed constants, whichever module happened to import this file
// first would freeze the real ~/.config/home for the rest of the process,
// silently redirecting every later test's "isolated" writes onto it.
function xdgConfigHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), '.config')
}

export const paths = {
  get home(): string {
    return homedir()
  },
  get configRoot(): string {
    return join(xdgConfigHome(), 'home')
  },
  get globalConfig(): string {
    return join(xdgConfigHome(), 'home', 'config.json')
  },
  get overviewConfig(): string {
    return join(xdgConfigHome(), 'home', 'overview.json')
  },
  get modulesDir(): string {
    return join(xdgConfigHome(), 'home', 'modules')
  },
  moduleConfig: (name: string): string => join(xdgConfigHome(), 'home', 'modules', `${name}.json`),
  get secretsFile(): string {
    return join(xdgConfigHome(), 'home', 'secrets.json')
  },
  get updateCache(): string {
    return join(xdgConfigHome(), 'home', 'update-check.json')
  },
  get skillsDir(): string {
    return join(homedir(), '.claude', 'skills')
  },
  skillDir: (module: string): string => join(homedir(), '.claude', 'skills', `home-${module}`),
  skillFile: (module: string): string => join(homedir(), '.claude', 'skills', `home-${module}`, 'SKILL.md'),
}
