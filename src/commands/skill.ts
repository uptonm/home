import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { writeAllSkills } from '../core/skill'
import { emit } from '../core/output'
import { modules } from '../registry'

const installArgs: ArgsDef = {
  json: { type: 'boolean', description: 'Emit JSON to stdout' },
}

export const skillCmd: CommandDef = defineCommand({
  meta: { name: 'skill', description: 'Manage Claude skills for home modules' },
  subCommands: {
    install: defineCommand({
      meta: { name: 'install', description: 'Write SKILL.md for every module under ~/.claude/skills/' },
      args: installArgs,
      async run({ args }) {
        const raw = args as Record<string, unknown>
        const json = Boolean(raw.json)
        const written = writeAllSkills(modules)
        emit({ ok: true, data: written }, { json })
      },
    }),
  },
})
