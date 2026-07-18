import type { ModuleManifest } from './core/types'
import unifiManifest from './modules/unifi'
import protectManifest from './modules/protect'
import assistantManifest from './modules/assistant'
import spotifyManifest from './modules/spotify'
import sonosManifest from './modules/sonos'
import ttsManifest from './modules/tts'
import googleManifest from './modules/google'
import gdriveManifest from './modules/gdrive'
import gmailManifest from './modules/gmail'
import gcalManifest from './modules/gcal'
import discordManifest from './modules/discord'
import vercelManifest from './modules/vercel'
import githubManifest from './modules/github'
import graphiteManifest from './modules/graphite'
import linearManifest from './modules/linear'
import beszelManifest from './modules/beszel'
import uptimeKumaManifest from './modules/uptime-kuma'

export const modules: ModuleManifest[] = [unifiManifest, protectManifest, assistantManifest, spotifyManifest, sonosManifest, ttsManifest, googleManifest, gdriveManifest, gmailManifest, gcalManifest, discordManifest, vercelManifest, githubManifest, graphiteManifest, linearManifest, beszelManifest, uptimeKumaManifest]

export const moduleByName: Record<string, ModuleManifest> = Object.fromEntries(
  modules.map((m) => [m.name, m] as const),
)
