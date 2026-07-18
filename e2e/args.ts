import { runCli } from './cli'
import { fixtures } from './fixtures'

/** A provider could not supply a value from live data (e.g. empty list). */
export class Unresolved extends Error {}

export type Provider = () => Promise<Record<string, string>>

const listCache = new Map<string, unknown>()

async function cachedJson(module: string, path: string[], args: string[] = []): Promise<unknown> {
  const key = [module, ...path, ...args].join(' ')
  const hit = listCache.get(key)
  if (hit !== undefined) return hit
  const res = await runCli(module, path, args)
  if (res.exitCode !== 0) throw new Unresolved(`${key} exited ${res.exitCode}`)
  if (res.json === null) throw new Unresolved(`${key} returned no JSON`)
  listCache.set(key, res.json)
  return res.json
}

async function rows(module: string, path: string[], args: string[] = []): Promise<unknown[]> {
  const data = await cachedJson(module, path, args)
  if (!Array.isArray(data)) throw new Unresolved(`${[module, ...path].join(' ')} did not return an array`)
  return data
}

export function pickField(rowsIn: unknown[], field: string): string | null {
  for (const r of rowsIn) {
    const v = (r as Record<string, unknown> | null)?.[field]
    if (v !== undefined && v !== null && v !== '') return String(v)
  }
  return null
}

export function unwrapItems(data: unknown, itemsKey: string): unknown[] | null {
  const items = (data as Record<string, unknown> | null)?.[itemsKey]
  return Array.isArray(items) ? items : null
}

function firstField(module: string, listPath: string[], field: string, argName: string, listArgs: string[] = []): Provider {
  return async () => {
    const all = await rows(module, listPath, listArgs)
    if (all.length === 0) throw new Unresolved(`${[module, ...listPath].join(' ')}: list empty`)
    const v = pickField(all, field)
    if (v === null) throw new Unresolved(`${[module, ...listPath].join(' ')}: no ${field} on any row`)
    return { [argName]: v }
  }
}

function firstFieldIn(module: string, listPath: string[], itemsKey: string, field: string, argName: string): Provider {
  return async () => {
    const key = [module, ...listPath].join(' ')
    const items = unwrapItems(await cachedJson(module, listPath), itemsKey)
    if (!items || items.length === 0) throw new Unresolved(`${key}: no ${itemsKey}[] rows`)
    const v = pickField(items, field)
    if (v === null) throw new Unresolved(`${key}: no ${field} on any ${itemsKey} row`)
    return { [argName]: v }
  }
}

/** spotify search returns { tracks: [...], albums: [...], ... }; pick the first
 *  match's canonical `id` — not `uri`, which container matches rewrite to a
 *  playable `spotify:track:<id>` on successful resolution, destroying the
 *  container reference `album get`/`artist albums`/`playlist tracks` etc. need. */
function spotifyRef(type: 'tracks' | 'albums' | 'artists' | 'playlists'): Provider {
  return async () => {
    const data = (await cachedJson('spotify', ['search'], ['daft punk'])) as Record<string, unknown>
    const items = data[type]
    const first = Array.isArray(items) ? (items[0] as Record<string, unknown> | undefined) : undefined
    const id = first?.id
    if (!id) throw new Unresolved(`spotify search: no ${type}[0].id`)
    return { ref: String(id) }
  }
}

const fixed = (values: Record<string, string>): Provider => async () => values

export const argProviders: Record<string, Provider> = {
  // unifi — get/stats chained off their list siblings
  'unifi devices get': firstField('unifi', ['devices', 'list'], 'mac', 'mac'),
  'unifi devices stats': firstField('unifi', ['devices', 'list'], 'mac', 'ref'),
  'unifi clients get': firstField('unifi', ['clients', 'list'], 'mac', 'mac'),
  'unifi dpi-stats client': firstField('unifi', ['clients', 'list'], 'mac', 'mac'),
  'unifi vouchers get': firstField('unifi', ['vouchers', 'list'], 'id', 'id'),
  'unifi networks get': firstField('unifi', ['networks', 'list'], 'name', 'name'),
  'unifi reservations get': firstField('unifi', ['reservations', 'list'], 'name', 'ref'),
  'unifi wlans get': firstField('unifi', ['wlans', 'list'], 'ssid', 'ssid'),
  'unifi port-forwards get': firstField('unifi', ['port-forwards', 'list'], 'name', 'name'),
  'unifi firewall get': firstField('unifi', ['firewall', 'list'], 'id', 'id'),
  'unifi firewall-groups get': firstField('unifi', ['firewall-groups', 'list'], 'name', 'name'),
  'unifi port-profiles get': firstField('unifi', ['port-profiles', 'list'], 'name', 'name'),
  'unifi wlan-groups get': firstField('unifi', ['wlan-groups', 'list'], 'name', 'name'),
  'unifi user-groups get': firstField('unifi', ['user-groups', 'list'], 'name', 'name'),
  'unifi radius-profiles get': firstField('unifi', ['radius-profiles', 'list'], 'name', 'name'),
  'unifi radius-accounts get': firstField('unifi', ['radius-accounts', 'list'], 'name', 'name'),
  'unifi routes get': firstField('unifi', ['routes', 'list'], 'name', 'name'),
  'unifi dpi-apps get': firstField('unifi', ['dpi-apps', 'list'], 'name', 'name'),
  'unifi dpi-groups get': firstField('unifi', ['dpi-groups', 'list'], 'name', 'name'),
  'unifi settings get': firstField('unifi', ['settings', 'list'], 'key', 'key'),
  // protect
  'protect cameras get': firstField('protect', ['cameras', 'list'], 'id', 'id'),
  'protect events get': firstField('protect', ['events', 'list'], 'id', 'id', ['--since', '7d', '--limit', '1']),
  'protect lights get': firstField('protect', ['lights', 'list'], 'id', 'ref'),
  'protect sensors get': firstField('protect', ['sensors', 'list'], 'id', 'ref'),
  'protect doorlocks get': firstField('protect', ['doorlocks', 'list'], 'id', 'ref'),
  'protect chimes get': firstField('protect', ['chimes', 'list'], 'id', 'ref'),
  'protect viewers get': firstField('protect', ['viewers', 'list'], 'id', 'ref'),
  'protect bridges get': firstField('protect', ['bridges', 'list'], 'id', 'ref'),
  'protect liveviews get': firstField('protect', ['liveviews', 'list'], 'id', 'ref'),
  'protect users get': firstField('protect', ['users', 'list'], 'id', 'ref'),
  'protect groups get': firstField('protect', ['groups', 'list'], 'id', 'ref'),
  // no 'protect snapshot' provider: it writes ./<camera>.jpg, so it's
  // classified write and excluded from auto-reads (same for tts synth).
  // assistant
  'assistant states search': fixed({ query: 'light' }),
  'assistant state get': firstField('assistant', ['states', 'list'], 'entity_id', 'entity'),
  'assistant history get': firstField('assistant', ['states', 'list'], 'entity_id', 'entity'),
  'assistant calendars get': firstField('assistant', ['calendars', 'list'], 'entity_id', 'entity'),
  'assistant template': fixed({ template: '{{ now() }}' }),
  // spotify — refs chained from one cached search
  'spotify search': fixed({ query: 'daft punk' }),
  'spotify track get': spotifyRef('tracks'),
  'spotify album get': spotifyRef('albums'),
  'spotify album tracks': spotifyRef('albums'),
  'spotify artist get': spotifyRef('artists'),
  'spotify artist albums': spotifyRef('artists'),
  'spotify artist top-tracks': spotifyRef('artists'),
  'spotify playlist get': spotifyRef('playlists'),
  'spotify playlist tracks': spotifyRef('playlists'),
  'spotify categories get': firstFieldIn('spotify', ['categories', 'list'], 'items', 'id', 'id'),
  // sonos
  'sonos players get': fixed({ room: fixtures.sonosRoom }),
  'sonos groups get': fixed({ room: fixtures.sonosRoom }),
  'sonos volume get': fixed({ room: fixtures.sonosRoom }),
  'sonos queue list': fixed({ room: fixtures.sonosRoom }),
  'sonos play-mode get': fixed({ room: fixtures.sonosRoom }),
  'sonos sleep-timer get': fixed({ room: fixtures.sonosRoom }),
  'sonos eq get': fixed({ room: fixtures.sonosRoom }),
  'sonos group-volume get': fixed({ room: fixtures.sonosRoom }),
  'sonos playlists get': firstField('sonos', ['playlists', 'list'], 'title', 'name'),
  'sonos alarms get': firstField('sonos', ['alarms', 'list'], 'id', 'id'),
  'sonos library browse': fixed({ category: 'albums' }),
  'sonos library search': fixed({ category: 'albums', query: 'daft' }),
  // gmail/gdrive: modules are skipped at preflight while unconfigured;
  // trivial chains included so they light up once configured
  'gmail messages get': firstField('gmail', ['messages', 'list'], 'id', 'id'),
  'gmail threads get': firstField('gmail', ['threads', 'list'], 'id', 'id'),
  'gmail labels get': firstField('gmail', ['labels', 'list'], 'id', 'id'),
  'gmail drafts get': firstField('gmail', ['drafts', 'list'], 'id', 'id'),
  'gdrive files get': firstField('gdrive', ['files', 'list'], 'id', 'file'),
  // discord get-messages needs a designated channel fixture — add when configured
  // github — chained off lists; --state all survives zero open PRs
  'github prs get': firstField('github', ['prs', 'list'], 'number', 'ref', ['--state', 'all', '--limit', '1']),
  'github prs checks': firstField('github', ['prs', 'list'], 'number', 'ref', ['--state', 'all', '--limit', '1']),
  'github prs diff': async () => {
    const base = await firstField('github', ['prs', 'list'], 'number', 'ref', ['--state', 'all', '--limit', '1'])()
    return { ...base, 'name-only': 'true' }
  },
  'github runs get': firstField('github', ['runs', 'list'], 'id', 'id'),
  'github issues get': firstField('github', ['issues', 'list'], 'number', 'ref', ['--state', 'all']),
  'github search code': fixed({ query: 'readGithubConfig', repo: fixtures.githubRepo, limit: '5' }),
  // graphite — pin reads to trunk so they work from untracked worktree branches
  'graphite stack get': fixed({ branch: fixtures.graphiteTrunk }),
  'graphite branch parent': fixed({ branch: fixtures.graphiteTrunk }),
  'graphite branch children': fixed({ branch: fixtures.graphiteTrunk }),
}
