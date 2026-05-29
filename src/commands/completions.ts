import { defineCommand, type ArgsDef, type CommandDef } from 'citty'
import { isShell, renderCompletion, SHELLS } from '../core/completion'
import { modules } from '../registry'

const args: ArgsDef = {
  shell: {
    type: 'positional',
    description: `Target shell: ${SHELLS.join(' | ')}`,
    required: true,
  },
}

export const completionsCmd: CommandDef = defineCommand({
  meta: {
    name: 'completions',
    description: 'Generate a shell completion script (bash | zsh | fish)',
  },
  args,
  async run({ args }) {
    const raw = args as Record<string, unknown>
    const shell = String(raw.shell ?? '')
    if (!isShell(shell)) {
      process.stderr.write(`error: unknown shell "${shell}" (expected ${SHELLS.join(', ')})\n`)
      process.exit(1)
    }
    const script = renderCompletion(shell, modules)
    process.stdout.write(script)
    process.exit(0)
  },
})
