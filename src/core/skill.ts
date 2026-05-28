import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { paths } from './paths'
import type { CommandSpec, ModuleManifest } from './types'

function ensureDir(path: string): void {
  if (!existsSync(path)) mkdirSync(path, { recursive: true })
}

function commandInvocation(module: string, spec: CommandSpec): string {
  const head = `home ${module} ${spec.path.join(' ')}`
  const positionals = spec.args.filter((a) => a.kind === 'positional').map((a) => `<${a.name}>`)
  const positional = positionals.length ? ' ' + positionals.join(' ') : ''
  return `\`${head}${positional} [args] --json\``
}

function commandsTable(module: string, commands: CommandSpec[]): string {
  const header = `| Command | Purpose |\n| --- | --- |`
  const rows = commands.map((c) => `| ${commandInvocation(module, c)} | ${c.description} |`)
  return [header, ...rows].join('\n')
}

function examplesBlock(commands: CommandSpec[]): string {
  const out: string[] = []
  for (const cmd of commands) {
    for (const ex of cmd.examples) {
      out.push(ex)
    }
  }
  if (out.length === 0) return '_No examples yet._'
  return '```bash\n' + out.join('\n') + '\n```'
}

export function renderSkill(manifest: ModuleManifest): string {
  return `---
name: home-${manifest.name}
description: ${manifest.description}
---

# home-${manifest.name}

${manifest.description}

The \`home\` CLI persists credentials locally, so you can call commands directly
without asking the user for tokens.

## Setup check

\`\`\`bash
home ${manifest.name} status
\`\`\`

Exit 0 = ready. Exit 3 = not configured — tell the user to run
\`home ${manifest.name} configure\` (interactive, you cannot drive it).

## Commands

${commandsTable(manifest.name, manifest.commands)}

All commands accept \`--json\` for structured output (stdout-only, errors on
stderr). Default human output is short tables — use \`--json\` when reading
programmatically.

## Examples

${examplesBlock(manifest.commands)}

## Exit codes

- 0 ok
- 1 user error (bad arg, unknown flag)
- 2 system error (network, controller unreachable)
- 3 not configured — run \`home ${manifest.name} configure\`

## When to use this skill

${manifest.whenToUse}
`
}

export function writeSkill(manifest: ModuleManifest): string {
  const path = paths.skillFile(manifest.name)
  ensureDir(dirname(path))
  writeFileSync(path, renderSkill(manifest))
  return path
}

export function writeAllSkills(manifests: ModuleManifest[]): string[] {
  ensureDir(paths.skillsDir)
  return manifests.map(writeSkill)
}
