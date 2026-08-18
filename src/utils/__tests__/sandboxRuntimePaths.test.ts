import { afterEach, describe, expect, test } from 'bun:test'
import {
  getDangerousDirectories,
  getDefaultWritePaths,
} from '@anthropic-ai/sandbox-runtime/dist/sandbox/sandbox-utils.js'

const originalMossConfigDir = process.env.MOSS_CONFIG_DIR

afterEach(() => {
  if (originalMossConfigDir === undefined) {
    delete process.env.MOSS_CONFIG_DIR
  } else {
    process.env.MOSS_CONFIG_DIR = originalMossConfigDir
  }
})

describe('sandbox runtime Moss paths', () => {
  test('protects Moss commands and agents instead of Claude directories', () => {
    const directories = getDangerousDirectories()

    expect(directories).toContain('.moss/commands')
    expect(directories).toContain('.moss/agents')
    expect(directories).not.toContain('.claude/commands')
    expect(directories).not.toContain('.claude/agents')
  })

  test('uses MOSS_CONFIG_DIR for sandbox debug output', () => {
    process.env.MOSS_CONFIG_DIR = '/tmp/custom-moss'

    expect(getDefaultWritePaths()).toContain('/tmp/custom-moss/debug')
  })
})
