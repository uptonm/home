import type { CommandSpec } from '../../../core/types'
import { listClients, readUnifiConfig } from '../client'

export const clientsList: CommandSpec = {
  path: ['clients', 'list'],
  description: 'List currently-connected clients',
  args: [],
  examples: [
    'home unifi clients list --json',
    'home unifi clients list --json | jq \'.[] | select(.hostname | test("phone";"i"))\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const data = await listClients(cfg)
    return { ok: true, data }
  },
}
