import { existsSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec, RunResult } from '../../../core/types'
import { discover, readSonosConfig, resolveRoom } from '../client'
import { pickLocalIpForPeer } from '../lan'

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/opus',
}

function mimeFor(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] ?? 'application/octet-stream'
}

/**
 * Sonos's SetAVTransportURI accepts the x-rincon-mp3radio:// scheme for
 * arbitrary HTTP-served audio (proven in earlier testing on this household —
 * plain http:// fails with UPnP 714 Illegal MIME-Type). We keep the rewrite
 * here at the command boundary so the rest of the code talks in real URLs.
 */
function rinconUrlForHost(ip: string, port: number, filename: string): string {
  return `x-rincon-mp3radio://${ip}:${port}/${filename}`
}

interface HostedFile {
  server: ReturnType<typeof Bun.serve>
  trackUri: string
}

function hostFile(filePath: string, peerIp: string): HostedFile {
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`)
  const size = statSync(filePath).size
  const mime = mimeFor(filePath)
  const localIp = pickLocalIpForPeer(peerIp)
  const filename = `${randomBytes(8).toString('hex')}${extname(filePath) || '.mp3'}`

  const server = Bun.serve({
    hostname: localIp,
    port: 0,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname !== `/${filename}`) return new Response('not found', { status: 404 })
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
      }
      if (req.method === 'HEAD') return new Response(null, { headers })
      return new Response(Bun.file(filePath), { headers })
    },
  })

  const port = server.port
  if (port === undefined) throw new Error('Bun.serve did not return a port')
  return { server, trackUri: rinconUrlForHost(localIp, port, filename) }
}

interface SavedState {
  currentUri: string
  currentUriMetaData: string
  trackNr: number
  relTime: string
  transportState: string
  volume: number
}

async function saveState(d: SonosDevice): Promise<SavedState> {
  const [media, position, transport, vol] = await Promise.all([
    d.AVTransportService.GetMediaInfo(),
    d.AVTransportService.GetPositionInfo(),
    d.AVTransportService.GetTransportInfo(),
    d.RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'Master' }),
  ])
  const metadata = typeof media.CurrentURIMetaData === 'string'
    ? media.CurrentURIMetaData
    : ''
  return {
    currentUri: media.CurrentURI,
    currentUriMetaData: metadata,
    trackNr: position.Track,
    relTime: position.RelTime,
    transportState: transport.CurrentTransportState,
    volume: vol.CurrentVolume,
  }
}

async function restoreState(d: SonosDevice, s: SavedState): Promise<void> {
  await d.RenderingControlService.SetVolume({ InstanceID: 0, Channel: 'Master', DesiredVolume: s.volume })
  if (!s.currentUri) return // nothing was loaded before; leave the transport empty
  try {
    await d.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: s.currentUri, CurrentURIMetaData: s.currentUriMetaData })
    if (s.trackNr > 0) {
      await d.AVTransportService.Seek({ InstanceID: 0, Unit: 'TRACK_NR', Target: String(s.trackNr) }).catch(() => {})
    }
    if (s.relTime && s.relTime !== '0:00:00' && s.relTime !== 'NOT_IMPLEMENTED') {
      await d.AVTransportService.Seek({ InstanceID: 0, Unit: 'REL_TIME', Target: s.relTime }).catch(() => {})
    }
    if (s.transportState === 'PLAYING') {
      await d.Play().catch(() => {})
    }
  } catch {
    // best-effort — if restoration fails the user can resume manually
  }
}

/**
 * Wait for the notification to finish by polling transport state. Mp3radio
 * streams Sonos pulls from us end as PLAYING → TRANSITIONING (Sonos thinks it's
 * a radio stream that just dropped its connection), not PLAYING → STOPPED, so
 * we treat *any* exit from PLAYING — once PLAYING was actually observed — as
 * the notification finishing. Two consecutive non-PLAYING samples are required
 * to avoid spurious transitions during buffering.
 */
async function waitForPlaybackEnd(d: SonosDevice, timeoutMs: number): Promise<'done' | 'timeout'> {
  const deadline = Date.now() + timeoutMs
  const pollMs = 300
  let nonPlayingStreak = 0
  let everPlayed = false
  while (Date.now() < deadline) {
    const ti = await d.AVTransportService.GetTransportInfo().catch(() => null)
    const state = ti?.CurrentTransportState
    if (state === 'PLAYING') {
      everPlayed = true
      nonPlayingStreak = 0
    } else if (everPlayed) {
      nonPlayingStreak++
      if (nonPlayingStreak >= 2) return 'done'
    }
    await new Promise((r) => setTimeout(r, pollMs))
  }
  return 'timeout'
}

const roomArg = { name: 'room', kind: 'positional', description: 'Room name (case-insensitive, partial match)', required: true } as const

export const notifyCmd: CommandSpec = {
  path: ['notify'],
  description: 'Play a one-shot audio notification on a room; preserves and restores the current queue, volume, and transport state',
  args: [
    roomArg,
    { name: 'file', kind: 'string', description: 'Local audio file path (we host it on the LAN for Sonos to fetch)' },
    { name: 'url', kind: 'string', description: 'Direct audio URL (must be reachable from the Sonos device)' },
    { name: 'volume', kind: 'number', description: 'Override volume just for the notification (0-100); restored after' },
    { name: 'timeout', kind: 'number', description: 'Max seconds to wait for the notification to finish (default 30)' },
  ],
  examples: [
    'home sonos notify "Living Room" --file /tmp/hello.mp3',
    'home sonos notify "Living Room" --url https://example.com/chime.mp3 --volume 40',
  ],
  async run(ctx): Promise<RunResult> {
    const ref = String(ctx.args.room ?? '')
    const file = ctx.args.file ? String(ctx.args.file) : undefined
    const url = ctx.args.url ? String(ctx.args.url) : undefined
    if (!file && !url) return { ok: false, kind: 'user', message: 'one of --file or --url is required', code: 'missing_arg' }
    if (file && url) return { ok: false, kind: 'user', message: '--file and --url are mutually exclusive', code: 'bad_arg' }

    const timeoutSec = ctx.args.timeout !== undefined ? Math.max(1, Number(ctx.args.timeout)) : 30
    const volumeOverride = ctx.args.volume !== undefined ? Math.max(0, Math.min(100, Math.round(Number(ctx.args.volume)))) : undefined

    const mgr = await discover(readSonosConfig(ctx.config))
    const r = resolveRoom(mgr.Devices, ref)
    if (r.kind === 'not_found') return { ok: false, kind: 'user', message: `no room matching "${ref}"`, code: 'not_found' }
    if (r.kind === 'ambiguous') return { ok: false, kind: 'user', message: `room is ambiguous — candidates: ${r.candidates.join(', ')}`, code: 'ambiguous' }
    const device = r.device

    let hosted: HostedFile | null = null
    let trackUri: string
    if (file) {
      hosted = hostFile(file, device.Host)
      trackUri = hosted.trackUri
    } else {
      trackUri = url!.replace(/^https?:\/\//i, 'x-rincon-mp3radio://')
    }

    const saved = await saveState(device)
    let completion: 'done' | 'timeout' = 'timeout'
    try {
      if (volumeOverride !== undefined) {
        await device.RenderingControlService.SetVolume({ InstanceID: 0, Channel: 'Master', DesiredVolume: volumeOverride })
      }
      await device.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: trackUri, CurrentURIMetaData: '' })
      await device.Play()
      completion = await waitForPlaybackEnd(device, timeoutSec * 1000)
    } finally {
      await restoreState(device, saved)
      hosted?.server.stop(true)
    }

    return {
      ok: true,
      data: {
        room: device.Name,
        action: 'notify',
        source: file ? { kind: 'file', path: file, servedAs: hosted!.trackUri } : { kind: 'url', url },
        completion,
        restored: { transportState: saved.transportState, volume: saved.volume },
      },
    }
  },
}
