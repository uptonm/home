import type { ModuleStatusState, RootStatusReport, RootStatusState } from './status'

const LABEL: Record<ModuleStatusState, string> = {
  ok: 'ok',
  error: 'unreachable',
  not_configured: 'not configured',
}

const SYMBOL: Record<ModuleStatusState, string> = {
  ok: '✔',
  error: '✖',
  not_configured: '○',
}

type Paint = (s: string) => string

function palette(enabled: boolean): {
  green: Paint
  red: Paint
  yellow: Paint
  gray: Paint
  dim: Paint
  bold: Paint
} {
  const wrap = (code: string): Paint => (s) => (enabled ? `\x1b[${code}m${s}\x1b[0m` : s)
  return {
    green: wrap('32'),
    red: wrap('31'),
    yellow: wrap('33'),
    gray: wrap('90'),
    dim: wrap('2'),
    bold: wrap('1'),
  }
}

function paintFor(state: ModuleStatusState, c: ReturnType<typeof palette>): Paint {
  return state === 'ok' ? c.green : state === 'error' ? c.red : c.gray
}

function headerStateColor(state: RootStatusState, c: ReturnType<typeof palette>): Paint {
  return state === 'ok' ? c.green : state === 'degraded' ? c.yellow : c.gray
}

/** Render the readiness report as a human status board: one row per module,
 * each showing just the service name and its state (ok / unreachable / not
 * configured). ANSI is emitted only when `color` is true. */
export function renderStatus(report: RootStatusReport, opts: { color: boolean }): string {
  const c = palette(opts.color)
  const { ok, error, notConfigured } = report.summary
  const summary = [
    c.green(`${ok} ok`),
    c.red(`${error} unreachable`),
    c.gray(`${notConfigured} not configured`),
  ].join(c.dim(' · '))
  const header = `${c.bold('home status')} ${c.dim('·')} ${headerStateColor(report.status, c)(report.status)}    ${summary}`

  const width = report.modules.reduce((max, m) => Math.max(max, m.module.length), 0)
  const rows = report.modules.map((m) => {
    const paint = paintFor(m.status, c)
    return `  ${paint(SYMBOL[m.status])} ${c.bold(m.module.padEnd(width))}   ${paint(LABEL[m.status])}`
  })

  return [header, '', ...rows].join('\n')
}
