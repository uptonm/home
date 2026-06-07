import type { CommandSpec } from '../../../core/types'
import { getSpace, listSpaces, readGchatConfig } from '../client'
import { PAGING_ARGS, listParamsFromArgs } from './args'
import { resolveSpaceOrError } from './resolve'

export const spacesList: CommandSpec = {
  path: ['spaces', 'list'],
  description: 'List Google Chat spaces the authenticated caller belongs to',
  args: [...PAGING_ARGS],
  examples: [
    'home gchat spaces list --json',
    'home gchat spaces list --filter \'spaceType = "SPACE"\' --json',
    'home gchat spaces list --page-size 20 --json | jq \'.spaces[] | {name, displayName}\'',
  ],
  async run(ctx) {
    const cfg = readGchatConfig(ctx.config)
    const parsed = listParamsFromArgs(ctx.args)
    if ('error' in parsed) return { ok: false, kind: 'user', message: parsed.error, code: 'bad_arg' }
    const data = await listSpaces(cfg, parsed.params)
    return { ok: true, data }
  },
}

export const spaceGet: CommandSpec = {
  path: ['spaces', 'get'],
  description: 'Get a single Google Chat space by resource name or display-name match',
  args: [
    {
      name: 'space',
      kind: 'positional',
      description: 'Space resource name (spaces/AAAA) or a display-name substring',
      required: true,
    },
  ],
  examples: [
    'home gchat spaces get spaces/AAAAExample --json',
    'home gchat spaces get "Engineering" --json',
  ],
  async run(ctx) {
    const cfg = readGchatConfig(ctx.config)
    const ref = String(ctx.args.space ?? '').trim()
    if (!ref) return { ok: false, kind: 'user', message: 'space is required', code: 'missing_arg' }
    const resolved = await resolveSpaceOrError(cfg, ref)
    if (!resolved.ok) return resolved.result
    const data = await getSpace(cfg, resolved.space.name)
    return { ok: true, data }
  },
}
