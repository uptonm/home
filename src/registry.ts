import type { ModuleManifest } from './core/types'
import unifiManifest from './modules/unifi'
import protectManifest from './modules/protect'
import assistantManifest from './modules/assistant'
import spotifyManifest from './modules/spotify'
import sonosManifest from './modules/sonos'
import ttsManifest from './modules/tts'
import gdriveManifest from './modules/gdrive'
import gchatManifest from './modules/gchat'
import gmailManifest from './modules/gmail'

export const modules: ModuleManifest[] = [unifiManifest, protectManifest, assistantManifest, spotifyManifest, sonosManifest, ttsManifest, gdriveManifest, gchatManifest, gmailManifest]

export const moduleByName: Record<string, ModuleManifest> = Object.fromEntries(
  modules.map((m) => [m.name, m] as const),
)
