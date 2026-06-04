import type { CommandSpec } from '../../../core/types'
import { getClient, listClients, readUnifiConfig } from '../client'

/** Normalize a MAC to canonical colon form (xx:xx:xx:xx:xx:xx). Strips non-hex chars first. */
function normalizeMac(raw: string): string | null {
  const hex = raw.toLowerCase().replace(/[^0-9a-f]/g, '')
  if (hex.length !== 12) return null
  return hex.match(/.{1,2}/g)!.join(':')
}

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

export const clientsGet: CommandSpec = {
  path: ['clients', 'get'],
  description: 'Fetch full stats for a single client (STA) by MAC — signal, channel, uptime, rx/tx history',
  args: [{ name: 'mac', kind: 'positional', description: 'Client MAC (with or without colons)', required: true }],
  examples: [
    'home unifi clients get 78:8a:20:11:22:33 --json',
    'home unifi clients get 78:8a:20:11:22:33 --json | jq \'{hostname, signal, channel, uptime}\'',
  ],
  async run(ctx) {
    const cfg = readUnifiConfig(ctx.config)
    const raw = String(ctx.args.mac ?? '')
    if (!raw) return { ok: false, kind: 'user', message: 'mac is required', code: 'missing_arg' }
    const mac = normalizeMac(raw)
    if (!mac) return { ok: false, kind: 'user', message: `invalid MAC: ${raw}`, code: 'invalid_arg' }
    const data = await getClient(cfg, mac)
    if (!data) return { ok: false, kind: 'user', message: `no client with mac ${mac}`, code: 'not_found' }
    return { ok: true, data }
  },
}
