import type { ModuleManifest } from '../../core/types'
import { defaultControllerUrl } from '../../core/net'
import { getBootstrap, readProtectConfig } from './client'
import { camerasGet, camerasList } from './commands/cameras'
import { camerasLed } from './commands/camera-led'
import { camerasPtz } from './commands/ptz'
import { camerasTalkback } from './commands/talkback'
import { eventsList, eventsRecent } from './commands/events'
import { lights } from './commands/lights'
import { snapshot } from './commands/snapshot'

export const manifest: ModuleManifest = {
  name: 'protect',
  description: 'Query and control UniFi Protect (cameras with PTZ/LED/talkback, lights, motion/smart events, snapshots)',
  whenToUse:
    'Use when the user asks about cameras, doorbells, recordings, motion events, or smart detections (person, package, vehicle). Do not use for network gear (`home-unifi`) or sensors/automations (`home-assistant`).',
  configSchema: [
    {
      key: 'url',
      label: 'Protect controller URL',
      kind: 'url',
      required: true,
      default: defaultControllerUrl,
    },
    {
      key: 'insecureTLS',
      label: 'Allow self-signed TLS certificate?',
      kind: 'boolean',
      default: false,
    },
    {
      key: 'username',
      label: 'Local Protect username',
      kind: 'string',
      required: true,
      help: 'controller-local user, not your Ubiquiti SSO',
    },
    {
      key: 'password',
      label: 'Local Protect password',
      kind: 'secret',
      required: true,
    },
  ],
  commands: [camerasList, camerasGet, camerasPtz, camerasLed, camerasTalkback, eventsList, eventsRecent, lights, snapshot],
  async status(cfg) {
    try {
      const bootstrap = await getBootstrap(readProtectConfig(cfg))
      const cameras = bootstrap.cameras ?? []
      return { ok: true, data: { cameras: cameras.length, status: 'reachable' } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
