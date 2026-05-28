import { ProtectApi } from 'unifi-protect'
import type { ModuleConfig } from '../../core/types'

export interface ProtectConfig {
  url: string
  host: string
  username: string
  password: string
  insecureTLS?: boolean
}

export function readProtectConfig(cfg: ModuleConfig): ProtectConfig {
  const url = String(cfg.url ?? '').replace(/\/+$/, '')
  let host = ''
  try {
    host = new URL(url).host
  } catch {
    host = url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  }
  return {
    url,
    host,
    username: String(cfg.username ?? ''),
    password: String(cfg.password ?? ''),
    insecureTLS: Boolean(cfg.insecureTLS),
  }
}

export async function connect(cfg: ProtectConfig): Promise<ProtectApi> {
  const api = new ProtectApi()
  const loggedIn = await api.login(cfg.host, cfg.username, cfg.password)
  if (!loggedIn) throw new Error(`Protect login failed for ${cfg.host}`)
  const booted = await api.getBootstrap()
  if (!booted) throw new Error(`Protect bootstrap failed for ${cfg.host}`)
  return api
}

export async function withApi<T>(cfg: ProtectConfig, fn: (api: ProtectApi) => Promise<T>): Promise<T> {
  const api = await connect(cfg)
  return fn(api)
}
