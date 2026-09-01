import { describe, expect, it } from 'bun:test'
import { supportsForkSubagentRuntime } from './forkSubagent.js'

describe('supportsForkSubagentRuntime', () => {
  it('allows interactive and desktop embedded sessions', () => {
    expect(supportsForkSubagentRuntime({
      coordinatorMode: false,
      nonInteractive: false,
      entrypoint: undefined,
    })).toBe(true)
    expect(supportsForkSubagentRuntime({
      coordinatorMode: false,
      nonInteractive: true,
      entrypoint: 'local-agent',
    })).toBe(true)
  })

  it('rejects coordinator and non-interactive CLI sessions', () => {
    expect(supportsForkSubagentRuntime({
      coordinatorMode: true,
      nonInteractive: false,
      entrypoint: 'local-agent',
    })).toBe(false)
    expect(supportsForkSubagentRuntime({
      coordinatorMode: false,
      nonInteractive: true,
      entrypoint: 'sdk-cli',
    })).toBe(false)
  })
})
