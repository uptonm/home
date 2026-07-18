import { describe, expect, test } from 'bun:test'
import { RefusedError, findCommand, runCli } from '../../e2e/cli'

describe('e2e spawn guard', () => {
  test('findCommand resolves a real command', () => {
    expect(findCommand('sonos', ['volume', 'get'])?.effect).toBe('read')
  })
  test('unknown command is refused before spawn', () => {
    expect(runCli('sonos', ['no', 'such'])).rejects.toThrow(RefusedError)
  })
  test('unknown module is refused before spawn', () => {
    expect(runCli('nope', ['list'])).rejects.toThrow(RefusedError)
  })
  test('destructive command is refused before spawn', () => {
    expect(runCli('unifi', ['devices', 'restart'], ['aa:bb'])).rejects.toThrow(RefusedError)
  })
})
