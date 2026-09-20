import { describe, expect, test } from 'bun:test'
import { TOOL_EXECUTION_COMPLETED, TOOL_EXECUTION_DISCARDED } from '../../utils/abortController.js'
import { linkWorkflowAbort } from './launchWorkflow.js'

describe('Workflow cancellation ownership', () => {
  test('stopping the parent session aborts the Workflow controller', () => {
    const parent = new AbortController()
    const workflow = new AbortController()
    const unlink = linkWorkflowAbort(parent.signal, workflow)

    parent.abort(new Error('user stopped'))

    expect(workflow.signal.aborted).toBe(true)
    expect(String(workflow.signal.reason)).toContain('user stopped')
    unlink()
  })

  test('normal WorkflowRun tool cleanup leaves the detached Workflow running', () => {
    const parent = new AbortController()
    const workflow = new AbortController()
    linkWorkflowAbort(parent.signal, workflow)

    parent.abort(TOOL_EXECUTION_COMPLETED)

    expect(workflow.signal.aborted).toBe(false)
  })

  test('discarding a WorkflowRun tool attempt cancels the detached run', () => {
    const parent = new AbortController()
    const workflow = new AbortController()
    linkWorkflowAbort(parent.signal, workflow)

    parent.abort(TOOL_EXECUTION_DISCARDED)

    expect(workflow.signal.aborted).toBe(true)
    expect(workflow.signal.reason).toBe(TOOL_EXECUTION_DISCARDED)
  })
})
