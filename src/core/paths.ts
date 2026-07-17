import { homedir } from 'node:os'
import { join } from 'node:path'

const HOME = homedir()
const XDG_CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(HOME, '.config')

export const paths = {
  home: HOME,
  configRoot: join(XDG_CONFIG_HOME, 'home'),
  globalConfig: join(XDG_CONFIG_HOME, 'home', 'config.json'),
  overviewConfig: join(XDG_CONFIG_HOME, 'home', 'overview.json'),
  modulesDir: join(XDG_CONFIG_HOME, 'home', 'modules'),
  moduleConfig: (name: string) => join(XDG_CONFIG_HOME, 'home', 'modules', `${name}.json`),
  secretsFile: join(XDG_CONFIG_HOME, 'home', 'secrets.json'),
  skillsDir: join(HOME, '.claude', 'skills'),
  skillDir: (module: string) => join(HOME, '.claude', 'skills', `home-${module}`),
  skillFile: (module: string) => join(HOME, '.claude', 'skills', `home-${module}`, 'SKILL.md'),
} as const
