import { describe, expect, test } from 'bun:test'
import { buildMemoryLines } from '../memdir/memdir.js'
import { asSessionId } from '../types/ids.js'
import { runWithSessionIdContext } from '../utils/sessionIdContext.js'
import {
  DEFAULT_SESSION_MEMORY_TEMPLATE_ZH,
  getDefaultSessionMemoryTemplate,
} from './SessionMemory/prompts.js'
import { buildConsolidationPrompt } from './autoDream/consolidationPrompt.js'
import { MOSS_RUNTIME_ADVANCED_SETTINGS_ENV } from './advancedSettings.js'
import { buildExtractAutoOnlyPrompt } from './extractMemories/prompts.js'
import {
  getMemoryLanguageInstruction,
  getResponseLanguage,
} from './responseLanguage.js'

function withResponseLanguage<T>(language: string, fn: () => T): T {
  return runWithSessionIdContext(
    asSessionId('response-language-test'),
    null,
    fn,
    undefined,
    {
      [MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]: JSON.stringify({
        moss_response_language: language,
      }),
    },
  )
}

describe('response language', () => {
  test('uses the session runtime language for replies and memory content', () => {
    withResponseLanguage('chinese', () => {
      expect(getResponseLanguage()).toBe('chinese')
      expect(getMemoryLanguageInstruction()).toContain(
        'memory titles, descriptions, headings, index summaries, and body content in chinese',
      )
      expect(getDefaultSessionMemoryTemplate()).toBe(
        DEFAULT_SESSION_MEMORY_TEMPLATE_ZH,
      )
    })
  })

  test('adds the language rule to direct writes, extraction, and Dream consolidation', () => {
    withResponseLanguage('chinese', () => {
      const directPrompt = buildMemoryLines('auto memory', '/tmp/memory/')
        .join('\n')
      const extractionPrompt = buildExtractAutoOnlyPrompt(4, '')
      const dreamPrompt = buildConsolidationPrompt(
        '/tmp/memory',
        '/tmp/transcripts',
        '',
      )

      for (const prompt of [directPrompt, extractionPrompt, dreamPrompt]) {
        expect(prompt).toContain('body content in chinese')
        expect(prompt).toContain('Keep frontmatter keys')
      }
      expect(directPrompt).toContain('Global-memory admission gate')
      expect(extractionPrompt).toContain('When uncertain, do not save anything')
      expect(extractionPrompt).not.toContain('<name>project</name>')
      expect(extractionPrompt).toContain('type: {{user, feedback, reference}}')
      expect(dreamPrompt).toContain('legacy global memories with `type: project`')
    })
  })
})
