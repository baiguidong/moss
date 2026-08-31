import { describe, expect, test } from 'bun:test'
import { buildMemoryLines } from './memdir.js'
import { buildExtractAutoOnlyPrompt } from '../services/extractMemories/prompts.js'

describe('main-session memory recall', () => {
  test('keeps MEMORY.md as the catalog in every recall mode', () => {
    const disabled = buildMemoryLines('auto memory', '/tmp/memory/', undefined, false).join('\n')
    const enabled = buildMemoryLines('auto memory', '/tmp/memory/', undefined, true).join('\n')

    for (const prompt of [disabled, enabled]) {
      expect(prompt).toContain('Saving a memory is a two-step process')
      expect(prompt).toContain('add a pointer to that file in `MEMORY.md`')
      expect(prompt).toContain('`MEMORY.md` is always loaded into your conversation context')
    }
  })

  test('makes the main model own on-demand recall when enabled', () => {
    const disabled = buildMemoryLines('auto memory', '/tmp/memory/', undefined, false).join('\n')
    const enabled = buildMemoryLines('auto memory', '/tmp/memory/', undefined, true).join('\n')

    expect(disabled).not.toContain('## Main-session on-demand recall')
    expect(enabled).toContain('## Main-session on-demand recall')
    expect(enabled).toContain('In this main conversation, decide whether any listed memory is relevant')
    expect(enabled).toContain('use Read to read the linked topic file before answering')
    expect(enabled).toContain('Do not invoke a separate model to select memories')
  })

  test('automatic extraction always updates the catalog', () => {
    const prompt = buildExtractAutoOnlyPrompt(4, '- user_profile.md')

    expect(prompt).toContain('Saving a memory is a two-step process')
    expect(prompt).toContain('add a pointer to that file in `MEMORY.md`')
    expect(prompt).toContain('`MEMORY.md` is always loaded into your system prompt')
  })
})
