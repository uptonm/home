import { SystemError } from './errors'

export interface HttpOptions {
  timeoutMs?: number
  retries?: number
  retryDelayMs?: (attempt: number) => number
  insecureTLS?: boolean
}

const DEFAULTS: Required<Omit<HttpOptions, 'insecureTLS'>> = {
  timeoutMs: 10_000,
  retries: 3,
  retryDelayMs: (attempt: number) => Math.min(250 * 2 ** attempt, 4_000),
}

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600
}

export async function request(url: string, init: RequestInit = {}, opts: HttpOptions = {}): Promise<Response> {
  const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
  const retries = opts.retries ?? DEFAULTS.retries
  const delayFn = opts.retryDelayMs ?? DEFAULTS.retryDelayMs

  let lastError: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const tlsExtras = opts.insecureTLS ? ({ tls: { rejectUnauthorized: false } } as RequestInit) : {}
      const res = await fetch(url, {
        ...init,
        ...tlsExtras,
        signal: controller.signal,
      })
      if (isRetryableStatus(res.status) && attempt < retries) {
        lastError = new SystemError(`HTTP ${res.status} from ${url}`, `http_${res.status}`)
        await sleep(delayFn(attempt))
        continue
      }
      return res
    } catch (err) {
      lastError = err
      if (attempt < retries && isNetworkError(err)) {
        await sleep(delayFn(attempt))
        continue
      }
      throw networkToSystemError(err, url)
    } finally {
      clearTimeout(timer)
    }
  }

  throw networkToSystemError(lastError, url)
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function isNetworkError(err: unknown): boolean {
  if (err instanceof Error) {
    const name = err.name
    return name === 'AbortError' || name === 'TypeError' || name === 'FetchError'
  }
  return false
}

function networkToSystemError(err: unknown, url: string): SystemError {
  if (err instanceof SystemError) return err
  const message = err instanceof Error ? err.message : String(err)
  return new SystemError(`request to ${url} failed: ${message}`, 'http_network')
}

export async function requestJson<T>(url: string, init: RequestInit = {}, opts: HttpOptions = {}): Promise<T> {
  const res = await request(url, init, opts)
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new SystemError(
      `HTTP ${res.status} ${res.statusText} from ${url}${body ? `: ${body.slice(0, 200)}` : ''}`,
      `http_${res.status}`,
    )
  }
  return (await res.json()) as T
}
