import type { Writable } from 'node:stream'
import type { RunResult } from './types'

export interface EmitOptions {
  json: boolean
}

function drain(stream: Writable, text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.write(text, (err) => (err ? reject(err) : resolve()))
  })
}

export async function emit(result: RunResult, { json }: EmitOptions): Promise<never> {
  if (result.ok) {
    if (json) {
      await drain(process.stdout, JSON.stringify(result.data ?? null) + '\n')
    } else if (result.data !== undefined && result.data !== null) {
      await drain(process.stdout, formatHuman(result.data) + '\n')
    }
    process.exit(0)
  }
  const code = result.kind === 'config' ? 3 : result.kind === 'user' ? 1 : 2
  if (json) {
    await drain(
      process.stdout,
      JSON.stringify({
        ok: false,
        code: result.code ?? result.kind,
        message: result.message,
      }) + '\n',
    )
  } else {
    await drain(process.stderr, `error: ${result.message}\n`)
  }
  process.exit(code)
}

function formatHuman(data: unknown): string {
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return formatTable(data)
  return JSON.stringify(data, null, 2)
}

function formatTable(rows: unknown[]): string {
  if (rows.length === 0) return '(empty)'
  if (rows.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    const objects = rows as Record<string, unknown>[]
    const keys = Array.from(
      objects.reduce((set, r) => {
        for (const k of Object.keys(r)) set.add(k)
        return set
      }, new Set<string>()),
    )
    const header = keys.join('\t')
    const body = objects.map((r) => keys.map((k) => stringify(r[k])).join('\t')).join('\n')
    return header + '\n' + body
  }
  return rows.map((r) => stringify(r)).join('\n')
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}
