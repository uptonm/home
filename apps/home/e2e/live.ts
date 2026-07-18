export type Phase = 'pending' | 'preflight' | 'reads' | 'scenarios' | 'done' | 'skipped'

export interface LiveState {
  module: string
  phase: Phase
  readsDone: number
  readsTotal: number
  scenario: string | null
  outcome: 'pass' | 'fail' | null
  skipReason: string | null
}

export function createLive(module: string): LiveState {
  return {
    module,
    phase: 'pending',
    readsDone: 0,
    readsTotal: 0,
    scenario: null,
    outcome: null,
    skipReason: null,
  }
}
