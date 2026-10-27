import { expect, test } from 'bun:test'
import { buildProjectSystemPrompts } from '../src/shared/project-system-prompts.mjs'

test('shared project constraints exclude main-session delivery and memory tool instructions', () => {
  const prompts = buildProjectSystemPrompts({ id: 'project-1', name: 'ESP32' }, {
    instructions: 'Use ESP32-S3.', manifest: { assets: [{ path: '/inputs/spec.md' }] },
  })
  expect(prompts.appendSystemPrompt).toContain('Use ESP32-S3.')
  expect(prompts.appendSystemPrompt).toContain('/inputs/spec.md')
  expect(prompts.appendSystemPrompt).not.toMatch(/ProjectResult|ProjectMemory|moss_present|main Agent/)
  expect(prompts.mainSessionSystemPrompt).toContain('ProjectResult')
  expect(prompts.mainSessionSystemPrompt).toContain('ProjectMemory')
  expect(buildProjectSystemPrompts(null)).toEqual({})
})
