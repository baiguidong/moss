import { describe, expect, test } from 'bun:test'
import { asSessionId } from '../../types/ids.js'
import { runWithSessionIdContext } from '../sessionIdContext.js'
import {
  getWorkflowDefinitionPath,
  getWorkflowRunPath,
  getWorkflowTranscriptDir,
} from './paths.js'

describe('workflow artifact paths', () => {
  test('use the stable owning conversation instead of a transient runtime id', () => {
    const paths = runWithSessionIdContext(
      asSessionId('runtime-session'),
      '/tmp/desktop-engine',
      () => ({
        definition: getWorkflowDefinitionPath('wf_12345678-abc', 'demo'),
        run: getWorkflowRunPath('wf_12345678-abc', 'demo'),
        transcript: getWorkflowTranscriptDir('wf_12345678-abc'),
      }),
      { kind: 'session', sessionId: 'desktop-session' },
    )

    expect(paths.definition).toBe('/tmp/desktop-engine/desktop-session/workflows/demo.wf_12345678-abc.workflow.json')
    expect(paths.run).toBe('/tmp/desktop-engine/desktop-session/workflows/demo.wf_12345678-abc.run.json')
    expect(paths.transcript).toBe('/tmp/desktop-engine/desktop-session/subagents/workflows/wf_12345678-abc')
  })
})
