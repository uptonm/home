import { describe, expect, test } from 'bun:test'
import { modules } from '../registry'
import { renderSkill } from '../core/skill'
import type { CommandSpec, ConfigField } from '../core/types'

describe('module manifests', () => {
  test('registry has at least one module', () => {
    expect(modules.length).toBeGreaterThan(0)
  })

  for (const m of modules) {
    describe(m.name, () => {
      test('has required top-level fields', () => {
        expect(typeof m.name).toBe('string')
        expect(typeof m.description).toBe('string')
        expect(typeof m.whenToUse).toBe('string')
        expect(Array.isArray(m.configSchema)).toBe(true)
        expect(Array.isArray(m.commands)).toBe(true)
        expect(typeof m.status).toBe('function')
        expect(m.status.constructor.name).toBe('AsyncFunction')
      })

      test('every configSchema field is well-formed', () => {
        for (const field of m.configSchema as ConfigField[]) {
          expect(typeof field.key).toBe('string')
          expect(typeof field.label).toBe('string')
          expect(['url', 'string', 'secret', 'enum', 'boolean']).toContain(field.kind)
        }
      })

      test('every command declares an effect', () => {
        for (const cmd of m.commands as CommandSpec[]) {
          expect(['read', 'write', 'destructive']).toContain(cmd.effect)
        }
      })

      test('every command is well-formed', () => {
        for (const cmd of m.commands as CommandSpec[]) {
          expect(Array.isArray(cmd.path)).toBe(true)
          expect(cmd.path.length).toBeGreaterThan(0)
          expect(typeof cmd.description).toBe('string')
          expect(Array.isArray(cmd.args)).toBe(true)
          expect(Array.isArray(cmd.examples)).toBe(true)
          expect(typeof cmd.run).toBe('function')
        }
      })

      test('SKILL.md renders without throwing and includes frontmatter', () => {
        const md = renderSkill(m)
        expect(md).toContain(`name: home-${m.name}`)
        expect(md).toContain(`description: ${m.description}`)
        expect(md).toContain(`# home-${m.name}`)
        expect(md).toContain('## When to use this skill')
      })
    })
  }
})
