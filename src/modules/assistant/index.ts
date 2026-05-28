import type { ModuleManifest } from '../../core/types'
import { info, readAssistantConfig } from './client'
import { stateGet, statesList } from './commands/states'
import { serviceCall } from './commands/service'
import { automationTrigger } from './commands/automation'
import { historyGet } from './commands/history'
import { logbookList } from './commands/logbook'

export const manifest: ModuleManifest = {
  name: 'assistant',
  description: 'Read and control Home Assistant — states, services, automations, history, logbook',
  whenToUse:
    'Use when the user asks about sensors, lights, switches, climate, automations, scenes, scripts, or any Home Assistant entity. Do not use for network gear (`home-unifi`) or cameras (`home-protect`).',
  configSchema: [
    {
      key: 'url',
      label: 'Home Assistant base URL (e.g. http://homeassistant.local:8123)',
      kind: 'url',
      required: true,
    },
    {
      key: 'token',
      label: 'Long-lived access token',
      kind: 'secret',
      required: true,
      help: 'Profile → Security → Long-lived access tokens → Create',
    },
  ],
  commands: [statesList, stateGet, serviceCall, automationTrigger, historyGet, logbookList],
  async status(cfg) {
    try {
      const data = await info(readAssistantConfig(cfg))
      return { ok: true, data: { message: data.message ?? '(no message)', version: data.version ?? '?' } }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
