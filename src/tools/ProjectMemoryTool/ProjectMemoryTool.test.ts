import { expect, test } from 'bun:test'
import { createProjectMemoryTool, createProjectResultTool } from './ProjectMemoryTool'

test('memory tools bind identity in the host and use ordinary permissions for corrections', async () => {
  const calls: unknown[] = []
  const tool = createProjectMemoryTool(async input => { calls.push(input); return { overview: 'project knowledge' } })
  expect(tool.inputSchema.safeParse({ action: 'read', projectId: 'other' }).success).toBe(false)
  expect(tool.isReadOnly({ action: 'search' })).toBe(true)
  expect(tool.isReadOnly({ action: 'note', text: 'remember this' })).toBe(false)
  expect(await tool.checkPermissions({ action: 'note', text: 'remember this' }, {} as any)).toMatchObject({ behavior: 'ask' })
  expect(await tool.validateInput({ action: 'note', text: ' ' }, {} as any)).toMatchObject({ result: false })
  expect(await tool.call({ action: 'read' }, {} as any, undefined as any, undefined as any)).toMatchObject({ data: JSON.stringify({ overview: 'project knowledge' }) })
  expect(calls).toEqual([{ action: 'read' }])
})

test('result registration is distinct from read-only listing and cannot choose a source session', async () => {
  const tool = createProjectResultTool(async input => input)
  expect(tool.inputSchema.safeParse({ action: 'register', path: 'report.md', sourceSessionId: 'other' }).success).toBe(false)
  expect(tool.isReadOnly({ action: 'list' })).toBe(true)
  expect(tool.isReadOnly({ action: 'register', path: 'report.md' })).toBe(false)
  expect(await tool.checkPermissions({ action: 'register', path: 'report.md' }, {} as any)).toMatchObject({ behavior: 'ask' })
})

test('worker calls cannot reach main-session project providers', async () => {
  let calls = 0
  const provider = async () => { calls++; return {} }
  const worker = { agentId: 'document-worker' } as any
  await expect(createProjectMemoryTool(provider).call({ action: 'note', text: 'remember' }, worker, undefined as any, undefined as any)).rejects.toThrow('main conversation')
  await expect(createProjectResultTool(provider).call({ action: 'register', path: 'report.md' }, worker, undefined as any, undefined as any)).rejects.toThrow('main conversation')
  expect(calls).toBe(0)
})
