import { defineCommand, runMain } from 'citty'
import { buildCommandTree } from './core/citty'
import { initCmd } from './commands/init'
import { configureAllCmd } from './commands/configure-all'
import { skillCmd } from './commands/skill'
import { doctorCmd } from './commands/doctor'
import { secretsCmd } from './commands/secrets'
import { configCmd } from './commands/config'
import { completionsCmd } from './commands/completions'
import { modules } from './registry'
import { HOME_COMMIT, HOME_VERSION } from './core/version'

const moduleSubCommands = Object.fromEntries(modules.map((m) => [m.name, buildCommandTree(m)] as const))

const verboseFlag = process.argv.includes('--verbose')
const versionString = verboseFlag ? `${HOME_VERSION} (${HOME_COMMIT})` : HOME_VERSION

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(versionString + '\n')
  process.exit(0)
}

const root = defineCommand({
  meta: {
    name: 'home',
    version: versionString,
    description: 'Monolith CLI for homelab services',
  },
  subCommands: {
    ...moduleSubCommands,
    init: initCmd,
    configure: configureAllCmd,
    skill: skillCmd,
    doctor: doctorCmd,
    secrets: secretsCmd,
    config: configCmd,
    completions: completionsCmd,
  },
})

runMain(root)
