import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, symlink } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createWorkflowDraft,
  deleteWorkflow,
  archiveWorkflow,
  getWorkflowCatalogDetail,
  listWorkflowCatalog,
  publishWorkflow,
  restoreWorkflow,
  unpublishWorkflow,
  updateWorkflowDraft,
} from './catalog.js'
import type { WorkflowDefinitionV3 } from './definition.js'

const DEFINITION: WorkflowDefinitionV3 = {
  version: 3,
  kind: 'state-machine',
  meta: {
    name: 'catalog-demo',
    title: 'Catalog demo',
    description: 'Exercises catalog revisions',
  },
  graph: {
    entry: 'input',
    nodes: [
      {
        id: 'input',
        type: 'start',
        title: 'Input',
        outputSchema: { type: 'object', properties: { value: { type: 'number' } } },
      },
      {
        id: 'value',
        type: 'code',
        title: 'Return value',
        language: 'javascript',
        input: [{ target: ['value'], source: { kind: 'workflow-input', path: ['value'] } }],
        script: 'return input.value',
        outputSchema: { type: 'number' },
      },
      {
        id: 'output',
        type: 'end',
        title: 'Output',
        inputSchema: { type: 'number' },
        input: [{ target: [], source: { kind: 'node-output', nodeId: 'value' } }],
      },
    ],
    edges: [
      { source: 'input', target: 'value' },
      { source: 'value', target: 'output' },
    ],
  },
}

describe('workflow catalog', () => {
  test('creates immutable revisions and publishes the selected current definition', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-catalog-'))
    try {
      const created = await createWorkflowDraft({
        definition: DEFINITION,
        scope: 'project',
        cwd,
        origin: { sessionId: 'session-1', toolUseId: 'tool-1' },
      })
      expect(created.record).toMatchObject({
        status: 'draft',
        currentRevision: 1,
        origin: { sessionId: 'session-1' },
      })
      expect(created.revision.graph.nodes.some(node => node.workflowNodeId === 'value')).toBe(true)

      const updated = await updateWorkflowDraft({
        workflowId: created.record.id,
        baseRevision: 1,
        cwd,
        definition: {
          ...DEFINITION,
          meta: { ...DEFINITION.meta, title: 'Catalog demo v2' },
          graph: {
            ...DEFINITION.graph,
            nodes: DEFINITION.graph.nodes.map(node => node.id === 'value'
              ? { ...node, title: 'Return new value', script: 'return input.value * 2' }
              : node),
          },
        },
        changeSummary: 'Double the input',
      })
      expect(updated.record.currentRevision).toBe(2)
      expect(updated.revisions.map(revision => revision.revision)).toEqual([2, 1])

      await expect(updateWorkflowDraft({
        workflowId: created.record.id,
        baseRevision: 1,
        cwd,
        definition: DEFINITION,
      })).rejects.toThrow('changed from revision 1 to 2')

      const published = await publishWorkflow({ workflowId: created.record.id, cwd })
      expect(published.record).toMatchObject({ status: 'published', publishedRevision: 2 })
      const saved = JSON.parse(await readFile(join(cwd, '.moss', 'workflows', 'catalog-demo.workflow.json'), 'utf8'))
      expect(saved.meta.title).toBe('Catalog demo v2')

      const firstRevision = await getWorkflowCatalogDetail({
        workflowId: created.record.id,
        revision: 1,
        cwd,
      })
      expect(firstRevision.revision.definition.meta.title).toBe('Catalog demo')
      await expect(getWorkflowCatalogDetail({
        workflowId: created.record.id,
        revision: 3,
        cwd,
      })).rejects.toThrow('only has committed revisions through 2')

      const listed = await listWorkflowCatalog({ cwd })
      expect(listed.find(entry => entry.id === created.record.id)).toMatchObject({
        id: created.record.id,
        status: 'published',
        currentRevision: 2,
      })

      const unpublished = await unpublishWorkflow({ workflowId: created.record.id, cwd })
      expect(unpublished.record.status).toBe('draft')
      const archived = await archiveWorkflow({ workflowId: created.record.id, cwd })
      expect(archived.record.status).toBe('archived')
      await expect(unpublishWorkflow({ workflowId: created.record.id, cwd }))
        .rejects.toThrow('must be restored')
      const restored = await restoreWorkflow({ workflowId: created.record.id, cwd })
      expect(restored.record.status).toBe('draft')
      await expect(restoreWorkflow({ workflowId: created.record.id, cwd }))
        .rejects.toThrow('Only archived')
      await deleteWorkflow({ workflowId: created.record.id, cwd })
      expect((await listWorkflowCatalog({ cwd })).some(entry => entry.id === created.record.id)).toBe(false)
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('does not overwrite another published workflow with the same name', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-catalog-collision-'))
    try {
      const first = await createWorkflowDraft({ definition: DEFINITION, scope: 'project', cwd })
      const second = await createWorkflowDraft({ definition: DEFINITION, scope: 'project', cwd })
      await publishWorkflow({ workflowId: first.record.id, cwd })
      await expect(publishWorkflow({ workflowId: second.record.id, cwd }))
        .rejects.toThrow("already exists")
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('keeps the last published revision visible while a newer draft is edited', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-catalog-published-view-'))
    try {
      const created = await createWorkflowDraft({ definition: DEFINITION, scope: 'project', cwd })
      await publishWorkflow({ workflowId: created.record.id, cwd })
      await updateWorkflowDraft({
        workflowId: created.record.id,
        baseRevision: 1,
        cwd,
        definition: {
          ...DEFINITION,
          meta: { ...DEFINITION.meta, title: 'Unconfirmed edit' },
        },
      })

      const templates = await listWorkflowCatalog({ cwd, publishedOnly: true })
      expect(templates.find(entry => entry.id === created.record.id)).toMatchObject({
        title: DEFINITION.meta.title,
        currentRevision: 2,
        publishedRevision: 1,
      })
      const drafts = await listWorkflowCatalog({ cwd, status: 'draft' })
      expect(drafts.find(entry => entry.id === created.record.id)?.title).toBe('Unconfirmed edit')
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('does not mark a workflow unpublished when its published file cannot be removed', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-catalog-unpublish-'))
    try {
      const created = await createWorkflowDraft({ definition: DEFINITION, scope: 'project', cwd })
      await publishWorkflow({ workflowId: created.record.id, cwd })
      const publishedFile = join(cwd, '.moss', 'workflows', 'catalog-demo.workflow.json')
      await rm(publishedFile)
      await mkdir(publishedFile)

      await expect(unpublishWorkflow({ workflowId: created.record.id, cwd })).rejects.toThrow()
      const detail = await getWorkflowCatalogDetail({ workflowId: created.record.id, cwd })
      expect(detail.record).toMatchObject({
        status: 'published',
        publishedRevision: 1,
        publishedFileName: 'catalog-demo.workflow.json',
      })
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('commits only one concurrent edit for the same base revision', async () => {
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-catalog-concurrent-'))
    try {
      const created = await createWorkflowDraft({ definition: DEFINITION, scope: 'project', cwd })
      const results = await Promise.allSettled([
        updateWorkflowDraft({
          workflowId: created.record.id,
          baseRevision: 1,
          cwd,
          definition: { ...DEFINITION, meta: { ...DEFINITION.meta, title: 'Edit A' } },
        }),
        updateWorkflowDraft({
          workflowId: created.record.id,
          baseRevision: 1,
          cwd,
          definition: { ...DEFINITION, meta: { ...DEFINITION.meta, title: 'Edit B' } },
        }),
      ])

      expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1)
      expect(results.filter(result => result.status === 'rejected')).toHaveLength(1)
      const detail = await getWorkflowCatalogDetail({ workflowId: created.record.id, cwd })
      expect(detail.record.currentRevision).toBe(2)
      expect(detail.revisions.map(revision => revision.revision)).toEqual([2, 1])
    } finally {
      await rm(cwd, { recursive: true, force: true })
    }
  })

  test('refuses to create a project catalog through a symlinked .moss directory', async () => {
    if (process.platform === 'win32') return
    const cwd = await mkdtemp(join(tmpdir(), 'moss-workflow-catalog-symlink-'))
    const outside = await mkdtemp(join(tmpdir(), 'moss-workflow-catalog-outside-'))
    try {
      await symlink(outside, join(cwd, '.moss'))
      await expect(createWorkflowDraft({ definition: DEFINITION, scope: 'project', cwd }))
        .rejects.toThrow('through a symlink')
      await expect(readFile(join(outside, 'workflows', '.catalog', '.catalog.lock')))
        .rejects.toThrow()
    } finally {
      await rm(cwd, { recursive: true, force: true })
      await rm(outside, { recursive: true, force: true })
    }
  })
})
