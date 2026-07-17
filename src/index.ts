import { defineCommand, runMain } from 'citty'
import { buildCommandTree } from './core/citty'
import { initCmd } from './commands/init'
import { configureAllCmd } from './commands/configure-all'
import { statusCmd } from './commands/status'
import { overviewCmd } from './commands/overview'
import { skillCmd } from './commands/skill'
import { doctorCmd } from './commands/doctor'
import { secretsCmd } from './commands/secrets'
import { configCmd } from './commands/config'
import { completionsCmd } from './commands/completions'
import { upgradeCmd } from './commands/upgrade'
import { modules } from './registry'
import { HOME_COMMIT, HOME_VERSION } from './core/version'
import { performUpdateCheck, preflight } from './core/update'

// Hidden internal: the detached refresh the preflight spawns. Handle it before
// anything else so it stays silent and never triggers its own preflight.
if (process.argv[2] === '__update-check') {
  await performUpdateCheck()
  process.exit(0)
}

const moduleSubCommands = Object.fromEntries(modules.map((m) => [m.name, buildCommandTree(m)] as const))

const verboseFlag = process.argv.includes('--verbose')
const versionString = verboseFlag ? `${HOME_VERSION} (${HOME_COMMIT})` : HOME_VERSION

if (process.argv.includes('--version') || process.argv.includes('-v')) {
  process.stdout.write(versionString + '\n')
  process.exit(0)
}

// The `upgrade` command reports version state itself — no banner right above it.
if (process.argv[2] !== 'upgrade') preflight(process.argv)

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
    status: statusCmd,
    overview: overviewCmd,
    skill: skillCmd,
    doctor: doctorCmd,
    secrets: secretsCmd,
    config: configCmd,
    completions: completionsCmd,
    upgrade: upgradeCmd,
  },
})

runMain(root)
