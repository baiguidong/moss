import { describe, expect, it } from 'bun:test'
import { supportsForkSubagentRuntime } from './forkSubagent.js'

describe('supportsForkSubagentRuntime', () => {
  it('allows interactive sessions only', () => {
    expect(supportsForkSubagentRuntime({
      coordinatorMode: false,
      nonInteractive: false,
      entrypoint: undefined,
    })).toBe(true)
  })

  it('rejects coordinator and every non-interactive session', () => {
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
    expect(supportsForkSubagentRuntime({
      coordinatorMode: false,
      nonInteractive: true,
      entrypoint: 'local-agent',
    })).toBe(false)
  })
})
