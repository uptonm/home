import type { CommandSpec } from '../../../core/types'
import { getMember, listMembers, memberName, readGchatConfig } from '../client'
import { PAGING_ARGS, listParamsFromArgs } from './args'
import { resolveSpaceOrError } from './resolve'

export const membersList: CommandSpec = {
  path: ['members', 'list'],
  description: 'List memberships (people and apps) in a Google Chat space',
  args: [
    {
      name: 'space',
      kind: 'positional',
      description: 'Space resource name (spaces/AAAA) or a display-name substring',
      required: true,
    },
    ...PAGING_ARGS,
  ],
  examples: [
    'home gchat members list spaces/AAAAExample --json',
    'home gchat members list "Engineering" --json | jq \'.members[] | {role, displayName: .member.displayName}\'',
  ],
  async run(ctx) {
    const cfg = readGchatConfig(ctx.config)
    const ref = String(ctx.args.space ?? '').trim()
    if (!ref) return { ok: false, kind: 'user', message: 'space is required', code: 'missing_arg' }
    const parsed = listParamsFromArgs(ctx.args)
    if ('error' in parsed) return { ok: false, kind: 'user', message: parsed.error, code: 'bad_arg' }
    const resolved = await resolveSpaceOrError(cfg, ref)
    if (!resolved.ok) return resolved.result
    const data = await listMembers(cfg, resolved.space.name, parsed.params)
    return { ok: true, data }
  },
}

export const memberGet: CommandSpec = {
  path: ['members', 'get'],
  description: 'Get a single membership in a Google Chat space',
  args: [
    {
      name: 'space',
      kind: 'positional',
      description: 'Space resource name (spaces/AAAA) or a display-name substring',
      required: true,
    },
    {
      name: 'member',
      kind: 'positional',
      description: 'Member id, or a full resource name (spaces/AAAA/members/BBBB)',
      required: true,
    },
  ],
  examples: [
    'home gchat members get spaces/AAAAExample 1234567890 --json',
    'home gchat members get "Engineering" spaces/AAAAExample/members/1234567890 --json',
  ],
  async run(ctx) {
    const cfg = readGchatConfig(ctx.config)
    const spaceRef = String(ctx.args.space ?? '').trim()
    const memberRef = String(ctx.args.member ?? '').trim()
    if (!spaceRef) return { ok: false, kind: 'user', message: 'space is required', code: 'missing_arg' }
    if (!memberRef) return { ok: false, kind: 'user', message: 'member is required', code: 'missing_arg' }
    const resolved = await resolveSpaceOrError(cfg, spaceRef)
    if (!resolved.ok) return resolved.result
    const data = await getMember(cfg, memberName(resolved.space.name, memberRef))
    return { ok: true, data }
  },
}
