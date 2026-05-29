import type { ModuleManifest } from '../../core/types'
import { getConfig, readAssistantConfig } from './client'
import { stateGet, statesList, statesSearch } from './commands/states'
import { serviceCall } from './commands/service'
import { lightCmd, switchCmd, climateCmd } from './commands/control'
import { automationTrigger } from './commands/automation'
import { historyGet } from './commands/history'
import { logbookList } from './commands/logbook'
import { sceneActivate, scriptRun } from './commands/scene-script'

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
  commands: [statesList, statesSearch, stateGet, lightCmd, switchCmd, climateCmd, sceneActivate, scriptRun, serviceCall, automationTrigger, historyGet, logbookList],
  async status(cfg) {
    try {
      const data = await getConfig(readAssistantConfig(cfg))
      return {
        ok: true,
        data: {
          version: data.version ?? '?',
          location: data.location_name ?? '?',
          timeZone: data.time_zone ?? '?',
          status: 'reachable',
        },
      }
    } catch (err) {
      return { ok: false, kind: 'system', message: (err as Error).message, code: 'status_failed' }
    }
  },
}

export default manifest
