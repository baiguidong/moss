import { afterEach, describe, expect, it } from 'bun:test'
import { applyDefaultConfigEnvironmentVariables } from '../managedEnv.js'

const ORIGINAL_DISABLE_EXPERIMENTAL_BETAS =
  process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS

function restoreEnv(): void {
  if (ORIGINAL_DISABLE_EXPERIMENTAL_BETAS === undefined) {
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS
  } else {
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS =
      ORIGINAL_DISABLE_EXPERIMENTAL_BETAS
  }
}

afterEach(() => {
  restoreEnv()
})

describe('applyDefaultConfigEnvironmentVariables', () => {
  it('defaults experimental betas off when unset', () => {
    delete process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS

    applyDefaultConfigEnvironmentVariables()

    expect(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe('1')
  })

  it('does not override an explicit env value', () => {
    process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS = '0'

    applyDefaultConfigEnvironmentVariables()

    expect(process.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS).toBe('0')
  })
})
