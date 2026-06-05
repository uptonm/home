import type { CommandSpec } from '../../../core/types'
import { getMessage, listMessages, messageName, readGchatConfig } from '../client'
import { ORDER_BY_ARG, PAGING_ARGS, listParamsFromArgs } from './args'
import { resolveSpaceOrError } from './resolve'

export const messagesList: CommandSpec = {
  path: ['messages', 'list'],
  description: 'List messages in a Google Chat space (supports filter and orderBy)',
  args: [
    {
      name: 'space',
      kind: 'positional',
      description: 'Space resource name (spaces/AAAA) or a display-name substring',
      required: true,
    },
    ...PAGING_ARGS,
    ORDER_BY_ARG,
  ],
  examples: [
    'home gchat messages list spaces/AAAAExample --order-by "createTime desc" --json',
    'home gchat messages list "Engineering" --page-size 20 --json | jq \'.messages[] | {createTime, text}\'',
    'home gchat messages list spaces/AAAAExample --filter \'createTime > "2024-01-01T00:00:00Z"\' --json',
  ],
  async run(ctx) {
    const cfg = readGchatConfig(ctx.config)
    const ref = String(ctx.args.space ?? '').trim()
    if (!ref) return { ok: false, kind: 'user', message: 'space is required', code: 'missing_arg' }
    const parsed = listParamsFromArgs(ctx.args, { orderBy: true })
    if ('error' in parsed) return { ok: false, kind: 'user', message: parsed.error, code: 'bad_arg' }
    const resolved = await resolveSpaceOrError(cfg, ref)
    if (!resolved.ok) return resolved.result
    const data = await listMessages(cfg, resolved.space.name, parsed.params)
    return { ok: true, data }
  },
}

export const messageGet: CommandSpec = {
  path: ['messages', 'get'],
  description: 'Get a single message in a Google Chat space',
  args: [
    {
      name: 'space',
      kind: 'positional',
      description: 'Space resource name (spaces/AAAA) or a display-name substring',
      required: true,
    },
    {
      name: 'message',
      kind: 'positional',
      description: 'Message id, or a full resource name (spaces/AAAA/messages/CCCC)',
      required: true,
    },
  ],
  examples: [
    'home gchat messages get spaces/AAAAExample CCCC.CCCC --json',
    'home gchat messages get "Engineering" spaces/AAAAExample/messages/CCCC.CCCC --json',
  ],
  async run(ctx) {
    const cfg = readGchatConfig(ctx.config)
    const spaceRef = String(ctx.args.space ?? '').trim()
    const messageRef = String(ctx.args.message ?? '').trim()
    if (!spaceRef) return { ok: false, kind: 'user', message: 'space is required', code: 'missing_arg' }
    if (!messageRef) return { ok: false, kind: 'user', message: 'message is required', code: 'missing_arg' }
    const resolved = await resolveSpaceOrError(cfg, spaceRef)
    if (!resolved.ok) return resolved.result
    const data = await getMessage(cfg, messageName(resolved.space.name, messageRef))
    return { ok: true, data }
  },
}
