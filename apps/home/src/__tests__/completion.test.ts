import { describe, expect, test } from 'bun:test'
import { modules } from '../registry'
import {
  buildCompletionTree,
  isShell,
  leafCommandPaths,
  renderCompletion,
  SHELLS,
  type CompletionNode,
} from '../core/completion'

function findNode(root: CompletionNode, path: string[]): CompletionNode | undefined {
  let node = root
  for (const part of path) {
    const next = node.subcommands.get(part)
    if (!next) return undefined
    node = next
  }
  return node
}

describe('completion tree', () => {
  const tree = buildCompletionTree(modules)

  test('includes every registered module as a top-level subcommand', () => {
    for (const m of modules) {
      expect(tree.subcommands.has(m.name)).toBe(true)
    }
  })

  test('includes the static top-level commands', () => {
    for (const name of ['init', 'configure', 'status', 'doctor', 'secrets', 'skill', 'completions']) {
      expect(tree.subcommands.has(name)).toBe(true)
    }
  })

  test('each module exposes synthetic configure/status/skill', () => {
    for (const m of modules) {
      const node = tree.subcommands.get(m.name)!
      expect(node.subcommands.has('configure')).toBe(true)
      expect(node.subcommands.has('status')).toBe(true)
      expect(node.subcommands.has('skill')).toBe(true)
    }
  })

  test('module configure carries --rotate and --force flags', () => {
    const node = findNode(tree, [modules[0]!.name, 'configure'])!
    const flagNames = node.flags.map((f) => f.name)
    expect(flagNames).toContain('--rotate')
    expect(flagNames).toContain('--force')
    expect(flagNames).toContain('--json')
  })

  test('grouped commands become nested nodes (protect cameras list)', () => {
    const node = findNode(tree, ['protect', 'cameras', 'list'])
    expect(node).toBeDefined()
    expect(node!.subcommands.size).toBe(0)
  })

  test('leaf flags are derived from command args (non-positional only)', () => {
    // protect events list has --since and --limit, no positionals.
    const node = findNode(tree, ['protect', 'events', 'list'])!
    const flagNames = node.flags.map((f) => f.name)
    expect(flagNames).toContain('--since')
    expect(flagNames).toContain('--limit')
    // global flags always present
    expect(flagNames).toContain('--json')
    // positionals must NOT appear as flags
    const snapshot = findNode(tree, ['protect', 'snapshot'])!
    expect(snapshot.flags.map((f) => f.name)).not.toContain('--camera')
  })

  test('completions node lists the supported shells as subcommands', () => {
    const node = tree.subcommands.get('completions')!
    for (const shell of SHELLS) {
      expect(node.subcommands.has(shell)).toBe(true)
    }
  })

  test('leafCommandPaths covers known commands and excludes the root', () => {
    const paths = leafCommandPaths(modules)
    expect(paths).toContain('assistant service call')
    expect(paths).toContain('protect cameras list')
    expect(paths).toContain('unifi devices list')
    expect(paths.every((p) => p.length > 0)).toBe(true)
  })
})

describe('isShell', () => {
  test('accepts the supported shells', () => {
    for (const shell of SHELLS) expect(isShell(shell)).toBe(true)
  })
  test('rejects anything else', () => {
    expect(isShell('powershell')).toBe(false)
    expect(isShell('')).toBe(false)
  })
})

describe('renderCompletion', () => {
  for (const shell of SHELLS) {
    describe(shell, () => {
      const script = renderCompletion(shell, modules)

      test('produces a non-empty script', () => {
        expect(script.length).toBeGreaterThan(0)
      })

      test('references the home binary', () => {
        expect(script).toContain('home')
      })

      test('mentions a known nested command token', () => {
        // every renderer should surface the "cameras" group somewhere.
        expect(script).toContain('cameras')
      })

      test('does not contain an unescaped TODO/placeholder', () => {
        expect(script).not.toContain('undefined')
        expect(script).not.toContain('[object Object]')
      })
    })
  }

  test('bash script defines the complete function and registers it', () => {
    const script = renderCompletion('bash', modules)
    expect(script).toContain('_home_complete()')
    expect(script).toContain('complete -F _home_complete home')
  })

  test('zsh script has the compdef header', () => {
    const script = renderCompletion('zsh', modules)
    expect(script.startsWith('#compdef home')).toBe(true)
  })

  test('fish script emits complete -c home lines', () => {
    const script = renderCompletion('fish', modules)
    expect(script).toContain('complete -c home')
    expect(script).toContain('__fish_use_subcommand')
  })

  test('descriptions with embedded single quotes are escaped for zsh', () => {
    // assistant "service call" --data description contains single quotes; they
    // must be escaped as '\'' inside the single-quoted _describe entry.
    const zsh = renderCompletion('zsh', modules)
    expect(zsh).toContain("'\\''")
    // and the case bodies must terminate correctly
    expect(zsh).toContain("');;")
  })
})
