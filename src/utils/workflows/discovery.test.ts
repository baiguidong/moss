import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadWorkflows, loadWorkflowsFromDir } from './discovery.js'
import type { WorkflowDefinitionV3 } from './definition.js'
import { saveWorkflowDefinition } from './save.js'
import { listWorkflowCatalog } from './catalog.js'

const DEFINITION: WorkflowDefinitionV3 = {
  version: 3,
  kind: 'state-machine',
  meta: {
    name: 'saved-demo',
    title: 'Saved demo',
    description: 'Saved definition test',
  },
  graph: {
    entry: 'input',
    nodes: [
      { id: 'input', type: 'start', title: 'Input', outputSchema: { type: 'object' } },
      { id: 'value', type: 'code', title: 'Return value', language: 'javascript', script: 'return 1', outputSchema: { type: 'number' } },
      { id: 'output', type: 'end', title: 'Output', inputSchema: { type: 'number' }, input: [{ target: [], source: { kind: 'node-output', nodeId: 'value' } }] },
    ],
    edges: [
      { source: 'input', target: 'value' },
      { source: 'value', target: 'output' },
    ],
  },
}

describe('structured workflow discovery', () => {
  test('discovers only validated .workflow.json definitions', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moss-workflow-discovery-'))
    try {
      await writeFile(join(dir, 'valid.workflow.json'), JSON.stringify(DEFINITION))
      await writeFile(join(dir, 'legacy.js'), 'export default {}')
      await writeFile(join(dir, 'invalid.workflow.json'), '{')

      const workflows = await loadWorkflowsFromDir(dir, 'userSettings')
      expect(workflows).toHaveLength(1)
      expect(workflows[0]).toMatchObject({
        name: 'saved-demo',
        definition: { version: 3, kind: 'state-machine' },
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  test('saves a project definition with the canonical extension', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'moss-workflow-save-'))
    try {
      const saved = await saveWorkflowDefinition({
        definition: DEFINITION,
        scope: 'project',
        cwd: dir,
      })
      if ('error' in saved) throw new Error(saved.error)
      expect(saved.filePath).toBe(join(dir, '.moss', 'workflows', 'saved-demo.workflow.json'))
      expect(saved.workflowId).toMatch(/^wfd_[a-f0-9]{16}$/)
      expect(JSON.parse(await readFile(saved.filePath, 'utf8'))).toEqual(DEFINITION)
      expect((await listWorkflowCatalog({ cwd: dir })).find(entry => entry.id === saved.workflowId))
        .toEqual(expect.objectContaining({
          id: saved.workflowId,
          status: 'published',
          publishedRevision: 1,
        }))
      expect((await loadWorkflows(dir)).find(workflow => workflow.name === 'saved-demo'))
        .toMatchObject({ source: 'projectSettings', definition: DEFINITION })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
