import { requestJson as coreRequestJson } from '../../core/http'
import type { ModuleConfig } from '../../core/types'

export const DISCORD_API_BASE = 'https://discord.com/api/v10'

export interface DiscordConfig {
  botToken: string
  guildId: string
}

export function readDiscordConfig(cfg: ModuleConfig): DiscordConfig {
  return {
    botToken: String(cfg.botToken ?? ''),
    guildId: String(cfg.guildId ?? ''),
  }
}

export async function requestJson<T>(path: string, init: RequestInit = {}, cfg: DiscordConfig): Promise<T> {
  const url = `${DISCORD_API_BASE}${path}`
  const headers: Record<string, string> = {
    Authorization: `Bot ${cfg.botToken}`,
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string> ?? {}),
  }
  return coreRequestJson<T>(url, { ...init, headers })
}
