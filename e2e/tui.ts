import type { LiveState } from './live'

const SPINNER = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
const TICK_MS = 100
const RUNNING: LiveState['phase'][] = ['preflight', 'reads', 'scenarios']

function symbol(s: LiveState, frame: number): string {
  if (s.phase === 'skipped') return '⊘'
  if (s.phase === 'done') return s.outcome === 'fail' ? '✖' : '✔'
  if (s.phase === 'pending') return ' '
  return SPINNER[frame % SPINNER.length]!
}

function activity(s: LiveState): string {
  switch (s.phase) {
    case 'pending':
      return 'queued'
    case 'preflight':
      return 'preflight'
    case 'reads':
      return `reads ${s.readsDone}/${s.readsTotal}`
    case 'scenarios':
      return s.scenario ? `scenario: ${s.scenario}` : 'scenarios'
    case 'skipped':
      return `skipped (${s.skipReason ?? '?'})`
    case 'done':
      return `${s.readsDone}/${s.readsTotal} reads`
  }
}

/**
 * Timer-driven in-place table: one row per module (array order stays stable
 * even as modules finish out of order), plus a footer. TTY-only — repaints by
 * moving the cursor up over the previous block. `stop()` paints one last frame.
 */
export function startTui(states: LiveState[], startedAt: number): { stop: () => void } {
  const width = Math.max(1, ...states.map((s) => s.module.length))
  let frame = 0
  let lastLines = 0

  function render(): void {
    frame++
    const lines = states.map((s) => `  ${symbol(s, frame)} ${s.module.padEnd(width)}  ${activity(s)}`)
    const running = states.filter((s) => RUNNING.includes(s.phase)).length
    const done = states.filter((s) => s.phase === 'done' || s.phase === 'skipped').length
    const elapsed = Math.round((Date.now() - startedAt) / 1000)
    lines.push(`  running ${running} · done ${done}/${states.length} · ${elapsed}s`)

    const up = lastLines ? `\x1b[${lastLines}A` : ''
    const body = lines.map((l) => `\x1b[2K${l}`).join('\n')
    process.stdout.write(`${up}${body}\n`)
    lastLines = lines.length
  }

  process.stdout.write('\x1b[?25l') // hide cursor
  render()
  const timer = setInterval(render, TICK_MS)
  return {
    stop() {
      clearInterval(timer)
      render()
      process.stdout.write('\x1b[?25h') // show cursor
    },
  }
}
