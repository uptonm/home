import { existsSync, rmSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { randomBytes } from 'node:crypto'
import type SonosDevice from '@svrooij/sonos/lib/sonos-device'
import type { CommandSpec, RunResult } from '../../../core/types'
import { toSonosTrackUri, withRoom } from '../client'
import { localIpForPeer } from '../lan'

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
 * For files we host ourselves (with proper Content-Type + Content-Length) Sonos
 * accepts plain http:// across every generation we tested (S1 Play:5 Gen 1
 * through S2 Arc). It's also dramatically faster than x-rincon-mp3radio://
 * (~300 ms vs ~7 s to start playing) and ends cleanly in STOPPED instead of
 * cycling PLAYING ↔ TRANSITIONING the way mp3radio does when the stream ends.
 */
function httpUrlForHost(ip: string, port: number, filename: string): string {
  return `http://${ip}:${port}/${filename}`
}

interface HostedFile {
  server: ReturnType<typeof Bun.serve>
  trackUri: string
}

function hostFile(filePath: string, peerIp: string, localIp: string): HostedFile {
  if (!existsSync(filePath)) throw new Error(`file not found: ${filePath}`)
  const size = statSync(filePath).size
  const mime = mimeFor(filePath)
  const filename = `${randomBytes(8).toString('hex')}${extname(filePath) || '.mp3'}`

  // `Bun.serve` returns synchronously and the listener is already accepting
  // connections by the time we get the port back. There's no race between
  // server creation and the SetAVTransportURI call ~10 ms later that asks
  // Sonos to fetch this URL — don't be tempted to `await` a non-existent
  // `.listening` promise.
  const server = Bun.serve({
    hostname: localIp,
    port: 0,
    fetch(req, srv) {
      // Source-IP gate: this file is intended for one specific speaker we
      // already know the IP of. Anyone else on the LAN (guest VLAN, IoT
      // device, neighbor on the same broadcast domain) hitting a guessed
      // filename gets a 404. The ~3-second server lifetime + 64-bit random
      // filename already make guessing infeasible; this closes the
      // "guessed within the window" residual.
      const requesterIp = srv.requestIP(req)?.address
      if (requesterIp && requesterIp !== peerIp) {
        return new Response('not found', { status: 404 })
      }
      const url = new URL(req.url)
      if (url.pathname !== `/${filename}`) return new Response('not found', { status: 404 })
      const headers: Record<string, string> = {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Cache-Control': 'no-store',
      }
      if (req.method === 'HEAD') return new Response(null, { headers })
      return new Response(Bun.file(filePath), { headers })
    },
  })

  const port = server.port
  if (port === undefined) throw new Error('Bun.serve did not return a port')
  return { server, trackUri: httpUrlForHost(localIp, port, filename) }
}

/**
 * Snapshot of the speaker's playback state captured before a notification
 * starts, used by `restoreState` to put everything back afterwards. Covers
 * what we can reasonably get back: URI + metadata, queue position, transport
 * state (PLAYING/PAUSED/STOPPED), volume, PlayMode (shuffle/repeat), and
 * CrossfadeMode.
 */
interface SavedState {
  currentUri: string
  currentUriMetaData: string
  trackNr: number
  relTime: string
  transportState: string
  volume: number
  playMode: string
  crossfadeMode: boolean
}

async function saveState(d: SonosDevice): Promise<SavedState> {
  const [media, position, transport, vol, settings, crossfade] = await Promise.all([
    d.AVTransportService.GetMediaInfo(),
    d.AVTransportService.GetPositionInfo(),
    d.AVTransportService.GetTransportInfo(),
    d.RenderingControlService.GetVolume({ InstanceID: 0, Channel: 'Master' }),
    d.AVTransportService.GetTransportSettings({ InstanceID: 0 }).catch(() => null),
    d.AVTransportService.GetCrossfadeMode({ InstanceID: 0 }).catch(() => null),
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
    playMode: settings?.PlayMode ?? 'NORMAL',
    crossfadeMode: crossfade?.CrossfadeMode ?? false,
  }
}

export type RestoreState = 'ok' | 'partial' | 'failed'

export interface RestoreOutcome {
  state: RestoreState
  /** Set when state !== 'ok'. Names the step that failed; downstream may show this to the operator. */
  reason?: string
}

/**
 * Put the speaker back to the state captured by `saveState`. Classifies failures:
 *
 * - `SetVolume` and the initial `SetAVTransportURI` are *load-bearing* — if
 *   either throws, the speaker is left in an undefined state (silent, wrong
 *   queue, wrong URI). Mark `restored: 'failed'` with the throwing step's
 *   description; the caller surfaces this in the response so the LLM /
 *   operator can apologize-and-investigate instead of being told `ok: true`.
 *
 * - `Seek` and `Play` are *best-effort*. The URI and volume are already back
 *   in place; missing the seek-to-position or the resume-playing is a minor
 *   UX regression the user can fix with one tap. Mark `restored: 'partial'`
 *   and the operation is still considered a success overall.
 */
async function restoreState(d: SonosDevice, s: SavedState): Promise<RestoreOutcome> {
  try {
    await d.RenderingControlService.SetVolume({ InstanceID: 0, Channel: 'Master', DesiredVolume: s.volume })
  } catch (err) {
    return { state: 'failed', reason: `SetVolume failed: ${(err as Error).message}` }
  }
  if (!s.currentUri) {
    // Nothing was loaded before — leave the transport empty.
    return { state: 'ok' }
  }
  try {
    await d.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: s.currentUri, CurrentURIMetaData: s.currentUriMetaData })
  } catch (err) {
    return { state: 'failed', reason: `SetAVTransportURI failed: ${(err as Error).message}` }
  }

  // PlayMode and CrossfadeMode are *cosmetic* — getting them wrong is a UX
  // regression the user can fix in one tap. Restore them before the seek/play
  // so the resumed playback already honors shuffle/repeat, then degrade to
  // 'partial' if either set call fails.
  let partial: string | null = null
  try {
    await d.AVTransportService.SetPlayMode({ InstanceID: 0, NewPlayMode: s.playMode as never })
  } catch (err) {
    partial = `SetPlayMode failed: ${(err as Error).message}`
  }
  if (!partial) {
    try {
      await d.AVTransportService.SetCrossfadeMode({ InstanceID: 0, CrossfadeMode: s.crossfadeMode })
    } catch (err) {
      partial = `SetCrossfadeMode failed: ${(err as Error).message}`
    }
  }

  if (!partial && s.trackNr > 0) {
    try {
      await d.AVTransportService.Seek({ InstanceID: 0, Unit: 'TRACK_NR', Target: String(s.trackNr) })
    } catch (err) {
      partial = `Seek (track) failed: ${(err as Error).message}`
    }
  }
  if (!partial && s.relTime && s.relTime !== '0:00:00' && s.relTime !== 'NOT_IMPLEMENTED') {
    try {
      await d.AVTransportService.Seek({ InstanceID: 0, Unit: 'REL_TIME', Target: s.relTime })
    } catch (err) {
      partial = `Seek (position) failed: ${(err as Error).message}`
    }
  }
  if (s.transportState === 'PLAYING') {
    try {
      await d.Play()
    } catch (err) {
      partial = partial ?? `Play (resume) failed: ${(err as Error).message}`
    }
  }
  return partial ? { state: 'partial', reason: partial } : { state: 'ok' }
}

const TERMINAL_STATES = new Set(['STOPPED', 'NO_MEDIA_PRESENT', 'PAUSED_PLAYBACK', 'TRANSITIONING'])
const MAX_CONSECUTIVE_POLL_FAILURES = 5

/**
 * Wait for the notification to finish by polling transport state.
 *
 * Sonos exits PLAYING via either STOPPED (clean end on http://) or
 * TRANSITIONING (mp3radio scheme treats the file as a radio stream that just
 * dropped its connection). Both count as "done" once we've actually observed
 * PLAYING — otherwise a 100ms gap between SetAVTransportURI and Play would
 * return immediately.
 *
 * Critically: a *transient* SOAP failure (network blip, Sonos under load,
 * Bun fetch hiccup) returns null from GetTransportInfo. If we treated null
 * as "exit PLAYING," any single mid-notification SOAP error would silently
 * end the wait, fire restoreState, and cut the audio off. We require a
 * *successful* poll returning a known-terminal state before declaring done,
 * and a separate consecutive-failure counter so a sustained outage still
 * eventually bails instead of polling forever.
 */
async function waitForPlaybackEnd(d: SonosDevice, timeoutMs: number): Promise<'done' | 'timeout' | 'unreachable'> {
  const deadline = Date.now() + timeoutMs
  const pollMs = 250
  let everPlayed = false
  let consecutiveFailures = 0
  while (Date.now() < deadline) {
    const ti = await d.AVTransportService.GetTransportInfo().catch(() => null)
    if (ti === null) {
      consecutiveFailures++
      if (consecutiveFailures >= MAX_CONSECUTIVE_POLL_FAILURES) return 'unreachable'
      await new Promise((r) => setTimeout(r, pollMs))
      continue
    }
    consecutiveFailures = 0
    const state = ti.CurrentTransportState
    if (state === 'PLAYING') {
      everPlayed = true
    } else if (everPlayed && TERMINAL_STATES.has(state)) {
      return 'done'
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
    { name: 'delete-after', kind: 'boolean', description: 'Delete the --file path after playback (success or failure). Use this when the file was a one-shot generated by `home tts synth` etc. — keeps /tmp from accumulating.' },
  ],
  examples: [
    'home sonos notify "Living Room" --file /tmp/hello.mp3',
    'home sonos notify "Living Room" --url https://example.com/chime.mp3 --volume 40',
    'FILE=$(home tts synth "Hi" --json | jq -r .path) && home sonos notify "Living Room" --file "$FILE" --delete-after',
  ],
  async run(ctx): Promise<RunResult> {
    const file = ctx.args.file ? String(ctx.args.file) : undefined
    const url = ctx.args.url ? String(ctx.args.url) : undefined
    if (!file && !url) return { ok: false, kind: 'user', message: 'one of --file or --url is required', code: 'missing_arg' }
    if (file && url) return { ok: false, kind: 'user', message: '--file and --url are mutually exclusive', code: 'bad_arg' }

    const timeoutSec = ctx.args.timeout !== undefined ? Math.max(1, Number(ctx.args.timeout)) : 30
    const volumeOverride = ctx.args.volume !== undefined ? Math.max(0, Math.min(100, Math.round(Number(ctx.args.volume)))) : undefined
    const deleteAfter = Boolean(ctx.args['delete-after'])
    if (deleteAfter && !file) {
      return { ok: false, kind: 'user', message: '--delete-after only applies to --file (no file to delete with --url)', code: 'bad_arg' }
    }

    return withRoom(ctx, { pick: 'device', required: true }, async (device) => {
      let hosted: HostedFile | null = null
      let trackUri: string
      if (file) {
        const localIp = await localIpForPeer(device.Host)
        hosted = hostFile(file, device.Host, localIp)
        trackUri = hosted.trackUri
      } else {
        trackUri = toSonosTrackUri(url!)
      }

      const saved = await saveState(device)
      let completion: 'done' | 'timeout' | 'unreachable' = 'timeout'
      let restored: RestoreOutcome = { state: 'failed', reason: 'restore did not run' }
      try {
        if (volumeOverride !== undefined) {
          await device.RenderingControlService.SetVolume({ InstanceID: 0, Channel: 'Master', DesiredVolume: volumeOverride })
        }
        await device.AVTransportService.SetAVTransportURI({ InstanceID: 0, CurrentURI: trackUri, CurrentURIMetaData: '' })
        await device.Play()
        completion = await waitForPlaybackEnd(device, timeoutSec * 1000)
      } finally {
        // Stop first because the notification source may be an indefinite
        // stream (`--url https://...` via toSonosTrackUri → x-rincon-mp3radio)
        // that won't end on its own — SetAVTransportURI during restore would
        // otherwise race with Sonos still pulling bytes from us.
        await device.Stop().catch(() => {})
        restored = await restoreState(device, saved)
        hosted?.server.stop(true)
        if (deleteAfter && file) {
          // Always rm — success or failure. Caller asked us to manage the file's
          // lifecycle, so we don't leave it lying around even if the restore
          // failed. Tempdir stays (empty); a separate sweep is out of scope.
          rmSync(file, { force: true })
        }
      }

      const data = {
        room: device.Name,
        action: 'notify',
        source: file ? { kind: 'file', path: file, servedAs: hosted!.trackUri } : { kind: 'url', url },
        completion,
        priorState: { transportState: saved.transportState, volume: saved.volume },
        restored,
      }

      // A `'failed'` restore means the speaker is silent / on the wrong queue
      // — the notification played but the user is worse off than before. Surface
      // that as a non-ok result so callers can apologize / investigate instead
      // of being told everything succeeded.
      if (restored.state === 'failed') {
        return {
          ok: false,
          kind: 'system',
          message: `notification played but state restore failed: ${restored.reason}`,
          code: 'restore_failed',
        }
      }

      return { ok: true, data }
    })
  },
}
