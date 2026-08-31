import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  getIsInteractive,
  setIsInteractive,
} from '../../bootstrap/state.js'
import { updateSettingsForSource } from '../../utils/settings/settings.js'
import { resetSettingsCache } from '../../utils/settings/settingsCache.js'
import { shouldEnablePromptSuggestion } from './promptSuggestion.js'

const originalConfigDir = process.env.MOSS_CONFIG_DIR
const originalPromptSuggestionEnv =
  process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
const originalAgentTeamsEnv =
  process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
const originalInteractive = getIsInteractive()
let tempRoot: string

beforeEach(async () => {
  tempRoot = await mkdtemp(join(tmpdir(), 'moss-prompt-suggestion-'))
  process.env.MOSS_CONFIG_DIR = tempRoot
  delete process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
  delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  setIsInteractive(true)
  resetSettingsCache()
})

afterEach(async () => {
  if (originalConfigDir === undefined) delete process.env.MOSS_CONFIG_DIR
  else process.env.MOSS_CONFIG_DIR = originalConfigDir
  if (originalPromptSuggestionEnv === undefined) {
    delete process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION
  } else {
    process.env.CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION =
      originalPromptSuggestionEnv
  }
  if (originalAgentTeamsEnv === undefined) {
    delete process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS
  } else {
    process.env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS = originalAgentTeamsEnv
  }
  setIsInteractive(originalInteractive)
  resetSettingsCache()
  await rm(tempRoot, { recursive: true, force: true })
})

describe('prompt suggestion setting', () => {
  test('defaults to enabled when the setting is absent', () => {
    expect(shouldEnablePromptSuggestion()).toBe(true)
  })

  test('honors an explicit disabled setting', () => {
    const result = updateSettingsForSource('userSettings', {
      promptSuggestionEnabled: false,
    })
    expect(result.error).toBeNull()
    expect(shouldEnablePromptSuggestion()).toBe(false)
  })
})
