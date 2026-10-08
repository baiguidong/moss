import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

mock.module('color-diff-napi', () => ({
  ColorDiff: {}, ColorFile: {}, getSyntaxTheme: () => ({}),
}))
const memoryPaths = await import('../../memdir/paths.js')
const agentMemory = await import('./agentMemory.js')
const { parseAgentFromJson, parseAgentFromMarkdown } = await import('./loadAgentsDir.js')

afterEach(() => mock.restore())

describe('custom agent loading', () => {
  for (const memoryEnabled of [false, true]) {
    test(`loads JSON and Markdown agents with memory ${memoryEnabled ? 'enabled' : 'disabled'}`, () => {
      spyOn(memoryPaths, 'isAutoMemoryEnabled').mockReturnValue(memoryEnabled)
      const memoryPrompt = spyOn(agentMemory, 'loadAgentMemoryPrompt').mockReturnValue('Saved agent context.')
      const definition = { description: 'Review code', tools: ['Grep'], memory: 'user' }
      const prompt = 'Review the requested changes.'
      const agents = [
        parseAgentFromJson('reviewer', { ...definition, prompt }),
        parseAgentFromMarkdown('/agents/reviewer.md', '/agents', { ...definition, name: 'reviewer' }, prompt, 'userSettings'),
      ]

      for (const agent of agents) {
        expect(agent).not.toBeNull()
        expect(agent!.tools).toEqual(memoryEnabled ? ['Grep', 'Write', 'Edit', 'Read'] : ['Grep'])
        expect(agent!.getSystemPrompt()).toBe(memoryEnabled ? `${prompt}\n\nSaved agent context.` : prompt)
      }
      expect(memoryPrompt).toHaveBeenCalledTimes(memoryEnabled ? 2 : 0)
    })
  }
})
