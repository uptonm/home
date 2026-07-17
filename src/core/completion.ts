import type { ArgSpec, CommandSpec, ModuleManifest } from './types'

export type Shell = 'bash' | 'zsh' | 'fish'

export const SHELLS: readonly Shell[] = ['bash', 'zsh', 'fish'] as const

export function isShell(value: string): value is Shell {
  return (SHELLS as readonly string[]).includes(value)
}

/**
 * A single completion option (flag or subcommand) attached to a node, carrying
 * its description so zsh/fish can show inline help.
 */
export interface CompletionOption {
  name: string
  description: string
}

/**
 * A node in the completion tree. `path` is the full token path from the binary
 * (excluding the binary name itself), e.g. ['protect', 'cameras', 'list'].
 * Leaf nodes have an empty `subcommands` map and may carry `flags`.
 */
export interface CompletionNode {
  path: string[]
  description: string
  subcommands: Map<string, CompletionNode>
  flags: CompletionOption[]
}

/** Flags every command leaf accepts (mirrors globalFlags in core/citty.ts). */
const GLOBAL_FLAGS: CompletionOption[] = [
  { name: '--json', description: 'Emit JSON to stdout (silent otherwise)' },
  { name: '--quiet', description: 'Suppress non-error output' },
  { name: '--verbose', description: 'Verbose debug output' },
]

/** Flags accepted by `<module> configure`. */
const CONFIGURE_FLAGS: CompletionOption[] = [
  { name: '--rotate', description: 'Re-prompt secrets only' },
  { name: '--force', description: 'Re-prompt every field, ignore existing values' },
  ...GLOBAL_FLAGS,
]

function flagsForArgs(args: ArgSpec[]): CompletionOption[] {
  const flags: CompletionOption[] = []
  for (const a of args) {
    if (a.kind === 'positional') continue
    flags.push({ name: `--${a.name}`, description: a.description })
  }
  return [...flags, ...GLOBAL_FLAGS]
}

function newNode(path: string[], description: string): CompletionNode {
  return { path, description, subcommands: new Map(), flags: [] }
}

function leafFromSpec(parentPath: string[], spec: CommandSpec): CompletionNode {
  const name = spec.path[spec.path.length - 1]!
  const node = newNode([...parentPath, name], spec.description)
  node.flags = flagsForArgs(spec.args)
  return node
}

/**
 * Build the completion node for one module, mirroring buildCommandTree in
 * core/citty.ts: synthetic configure/status/skill commands plus the module's
 * own leaf and grouped commands.
 */
function moduleNode(manifest: ModuleManifest): CompletionNode {
  const root = newNode([manifest.name], manifest.description)

  const configure = newNode([manifest.name, 'configure'], `Configure ${manifest.name} (interactive)`)
  configure.flags = CONFIGURE_FLAGS
  root.subcommands.set('configure', configure)

  const status = newNode([manifest.name, 'status'], `Check ${manifest.name} connectivity`)
  status.flags = GLOBAL_FLAGS
  root.subcommands.set('status', status)

  const skill = newNode([manifest.name, 'skill'], `Regenerate the home-${manifest.name} Claude skill`)
  skill.flags = GLOBAL_FLAGS
  root.subcommands.set('skill', skill)

  // classify: single-depth → direct subcommand; deeper → grouped.
  // Keep in sync with buildCommandTree in core/citty.ts — both assume max depth 2.
  const groups = new Map<string, CommandSpec[]>()
  for (const cmd of manifest.commands) {
    if (cmd.path.length === 1) {
      root.subcommands.set(cmd.path[0]!, leafFromSpec([manifest.name], cmd))
    } else {
      const head = cmd.path[0]!
      if (!groups.has(head)) groups.set(head, [])
      groups.get(head)!.push(cmd)
    }
  }

  for (const [groupName, specs] of groups) {
    const group = newNode([manifest.name, groupName], `${groupName} commands`)
    for (const spec of specs) {
      const tailName = spec.path[spec.path.length - 1]!
      const leaf = leafFromSpec([manifest.name, groupName], spec)
      group.subcommands.set(tailName, leaf)
    }
    root.subcommands.set(groupName, group)
  }

  return root
}

/**
 * Build the full completion tree for the `home` binary from the module
 * registry plus the static top-level commands defined in src/index.ts.
 *
 * Keep this list in sync with the top-level commands wired in src/index.ts.
 */
export function buildCompletionTree(manifests: ModuleManifest[]): CompletionNode {
  const root = newNode([], 'Monolith CLI for homelab services')

  for (const m of manifests) {
    root.subcommands.set(m.name, moduleNode(m))
  }

  const staticTop: Array<[string, string, CompletionOption[]]> = [
    ['init', 'Initialise home configuration', GLOBAL_FLAGS],
    ['configure', 'Configure all modules (interactive)', GLOBAL_FLAGS],
    ['status', 'Check readiness across every module', [{ name: '--json', description: 'Emit JSON to stdout' }]],
    ['doctor', 'Check status across modules and look for updates', [{ name: '--json', description: 'Emit JSON to stdout' }]],
    ['secrets', 'Manage stored secrets', GLOBAL_FLAGS],
    ['completions', 'Generate a shell completion script', GLOBAL_FLAGS],
  ]
  for (const [name, description, flags] of staticTop) {
    const node = newNode([name], description)
    node.flags = flags
    root.subcommands.set(name, node)
  }

  // `skill` top-level has an `install` subcommand.
  const skill = newNode(['skill'], 'Manage Claude skills for home modules')
  const install = newNode(['skill', 'install'], 'Write SKILL.md for every module under ~/.claude/skills/')
  install.flags = [{ name: '--json', description: 'Emit JSON to stdout' }]
  skill.subcommands.set('install', install)
  root.subcommands.set('skill', skill)

  // `completions` takes a shell argument; expose the shells as pseudo-subcommands.
  const completions = root.subcommands.get('completions')!
  for (const shell of SHELLS) {
    completions.subcommands.set(shell, newNode(['completions', shell], `${shell} completion script`))
  }

  return root
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function collectLeafPaths(node: CompletionNode, acc: CompletionNode[]): void {
  if (node.subcommands.size === 0) {
    acc.push(node)
    return
  }
  for (const child of node.subcommands.values()) collectLeafPaths(child, acc)
}

/** All nodes (including internal) flattened, root excluded. */
function collectAllNodes(node: CompletionNode, acc: CompletionNode[]): void {
  for (const child of node.subcommands.values()) {
    acc.push(child)
    collectAllNodes(child, acc)
  }
}

function escapeSingle(value: string): string {
  return value.replace(/'/g, "'\\''")
}

/**
 * Bash completion: a single function that walks COMP_WORDS to find the current
 * command node, then offers that node's subcommands + flags.
 */
function renderBash(root: CompletionNode): string {
  const lines: string[] = []
  const allNodes: CompletionNode[] = []
  collectAllNodes(root, allNodes)

  lines.push('# bash completion for home')
  lines.push('# install: home completions bash > /usr/local/etc/bash_completion.d/home')
  lines.push('#      or: home completions bash >> ~/.bashrc')
  lines.push('_home_complete() {')
  lines.push('  local cur words cword')
  lines.push('  COMPREPLY=()')
  lines.push('  cur="${COMP_WORDS[COMP_CWORD]}"')
  lines.push('  # Build the command path: all non-flag words after the binary.')
  lines.push('  local path=""')
  lines.push('  local i')
  lines.push('  for ((i=1; i < COMP_CWORD; i++)); do')
  lines.push('    local w="${COMP_WORDS[i]}"')
  lines.push('    [[ "$w" == -* ]] && continue')
  lines.push('    path="${path}${path:+ }${w}"')
  lines.push('  done')
  lines.push('  local opts=""')
  lines.push('  case "$path" in')

  // Root (no path yet).
  const rootChildren = [...root.subcommands.keys(), ...root.flags.map((f) => f.name)]
  lines.push('    "")')
  lines.push(`      opts="${rootChildren.join(' ')}";;`)

  for (const node of allNodes) {
    if (node.subcommands.size === 0 && node.flags.length === 0) continue
    const key = node.path.join(' ')
    const tokens = [...node.subcommands.keys(), ...node.flags.map((f) => f.name)]
    lines.push(`    "${escapeSingle(key)}")`)
    lines.push(`      opts="${tokens.join(' ')}";;`)
  }

  lines.push('  esac')
  lines.push('  COMPREPLY=( $(compgen -W "${opts}" -- "${cur}") )')
  lines.push('  return 0')
  lines.push('}')
  lines.push('complete -F _home_complete home')
  lines.push('')
  return lines.join('\n')
}

/**
 * Zsh completion using _describe per node so descriptions show inline.
 */
function renderZsh(root: CompletionNode): string {
  const lines: string[] = []
  const allNodes: CompletionNode[] = []
  collectAllNodes(root, allNodes)

  lines.push('#compdef home')
  lines.push('# zsh completion for home')
  lines.push('# install: home completions zsh > "${fpath[1]}/_home"  (then restart zsh)')
  lines.push('_home() {')
  lines.push('  local -a path_words')
  lines.push('  local w')
  lines.push('  local -i upto=$(( CURRENT - 1 ))')
  lines.push('  (( upto < 1 )) && upto=0')
  lines.push('  local -i idx=2')
  lines.push('  while (( idx <= upto )); do')
  lines.push('    w="${words[idx]}"')
  lines.push('    idx+=1')
  lines.push('    [[ "$w" == -* ]] && continue')
  lines.push('    path_words+=("$w")')
  lines.push('  done')
  lines.push('  local key="${(j: :)path_words}"')
  lines.push('  local -a opts')
  lines.push('  case "$key" in')

  const emitCase = (key: string, node: CompletionNode): void => {
    const entries: string[] = []
    for (const [name, child] of node.subcommands) {
      entries.push(`'${escapeSingle(name)}:${escapeSingle(child.description)}'`)
    }
    for (const flag of node.flags) {
      entries.push(`'${escapeSingle(flag.name)}:${escapeSingle(flag.description)}'`)
    }
    if (entries.length === 0) return
    lines.push(`    '${escapeSingle(key)}')`)
    lines.push(`      opts=(${entries.join(' ')});;`)
  }

  emitCase('', root)
  for (const node of allNodes) {
    if (node.subcommands.size === 0 && node.flags.length === 0) continue
    emitCase(node.path.join(' '), node)
  }

  lines.push('  esac')
  lines.push("  _describe 'home' opts")
  lines.push('}')
  lines.push('_home "$@"')
  lines.push('')
  return lines.join('\n')
}

/**
 * Fish completion: one `complete` line per node, gated on the command path
 * using a helper that matches the seen tokens.
 */
function renderFish(root: CompletionNode): string {
  const lines: string[] = []
  lines.push('# fish completion for home')
  lines.push('# install: home completions fish > ~/.config/fish/completions/home.fish')
  lines.push('')
  lines.push('function __home_seen_path')
  lines.push('  set -l tokens (commandline -opc)')
  lines.push('  set -e tokens[1]')
  lines.push('  set -l path (string join " " -- $tokens)')
  lines.push('  test "$path" = "$argv[1]"')
  lines.push('end')
  lines.push('')

  const emit = (parentPath: string[], node: CompletionNode): void => {
    const parentKey = parentPath.join(' ')
    const condition = parentPath.length === 0
      ? '__fish_use_subcommand'
      : `__home_seen_path '${escapeSingle(parentKey)}'`
    for (const [name, child] of node.subcommands) {
      lines.push(
        `complete -c home -f -n "${condition}" -a '${escapeSingle(name)}' -d '${escapeSingle(child.description)}'`,
      )
    }
    for (const flag of node.flags) {
      const long = flag.name.replace(/^--/, '')
      lines.push(
        `complete -c home -f -n "${condition}" -l '${escapeSingle(long)}' -d '${escapeSingle(flag.description)}'`,
      )
    }
    for (const child of node.subcommands.values()) {
      emit(child.path, child)
    }
  }

  emit([], root)
  lines.push('')
  return lines.join('\n')
}

export function renderCompletion(shell: Shell, manifests: ModuleManifest[]): string {
  const tree = buildCompletionTree(manifests)
  switch (shell) {
    case 'bash':
      return renderBash(tree)
    case 'zsh':
      return renderZsh(tree)
    case 'fish':
      return renderFish(tree)
  }
}

/** Exported for tests: every leaf command path in the tree. */
export function leafCommandPaths(manifests: ModuleManifest[]): string[] {
  const tree = buildCompletionTree(manifests)
  const leaves: CompletionNode[] = []
  collectLeafPaths(tree, leaves)
  return leaves.map((n) => n.path.join(' ')).filter((p) => p.length > 0)
}
