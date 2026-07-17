import type { CommandSpec } from '../../../core/types'
import { listDynamicDns, readUnifiConfig } from '../client'

interface RawDdns { _id: string; service?: string; hostname?: string; [key: string]: unknown }

export const dynamicDnsList: CommandSpec = {
  path: ['dynamic-dns', 'list'],
  effect: 'read',
  description: 'List Dynamic DNS configurations',
  args: [],
  examples: ['home unifi dynamic-dns list', 'home unifi dynamic-dns list --json'],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const ddns = (await listDynamicDns(cfg)) as RawDdns[]
    const data = ddns
      .map((d) => ({ service: d.service ?? '', hostname: d.hostname ?? '' }))
      .sort((a, b) => a.service.localeCompare(b.service))
    return { ok: true, data }
  },
}