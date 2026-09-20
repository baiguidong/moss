import React, { useCallback, useMemo, useState } from 'react'
import { getOriginalCwd } from '../../bootstrap/state.js'
import { PermissionDialog } from '../../components/permissions/PermissionDialog.js'
import {
  PermissionPrompt,
  type PermissionPromptOption,
  type ToolAnalyticsContext,
} from '../../components/permissions/PermissionPrompt.js'
import type { PermissionRequestProps } from '../../components/permissions/PermissionRequest.js'
import { PermissionRuleExplanation } from '../../components/permissions/PermissionRuleExplanation.js'
import {
  type UnaryEvent,
  usePermissionRequestLogging,
} from '../../components/permissions/hooks.js'
import { Box, Text } from '../../ink.js'
import { sanitizeToolNameForAnalytics } from '../../services/analytics/metadata.js'
import { shouldShowAlwaysAllowOptions } from '../../utils/permissions/permissionsLoader.js'
import type {
  WorkflowDefinitionV3,
  WorkflowNode,
} from '../../utils/workflows/definition.js'
import { WORKFLOW_TOOL_NAME } from './constants.js'

type WorkflowOptionValue = 'yes' | 'yes-always' | 'view' | 'no'

/**
 * Approval dialog shown before a dynamic workflow starts.
 *
 * Agent nodes continue under the owning session's permission mode; approving
 * the Workflow itself does not pre-approve later tool calls.
 */
export function WorkflowPermissionRequest(
  props: PermissionRequestProps,
): React.ReactNode {
  const { toolUseConfirm, onDone, onReject, workerBadge } = props

  const unaryEvent = useMemo<UnaryEvent>(
    () => ({ completion_type: 'tool_use_single', language_name: 'none' }),
    [],
  )
  usePermissionRequestLogging(toolUseConfirm, unaryEvent)

  const input = toolUseConfirm.input as {
    definition?: WorkflowDefinitionV3
    name?: string
    workflowId?: string
    revision?: number
    mode?: 'test' | 'run'
    definitionPath?: string
    args?: unknown
  }
  const definition = input.definition
  const meta = definition?.meta
  const workflowName = meta?.name ?? input.name ?? input.workflowId ?? 'workflow'
  const description = meta?.description
  const phases = definition ? collectActions(definition.graph.nodes) : []
  const originalCwd = getOriginalCwd()
  const showAlwaysAllow = shouldShowAlwaysAllowOptions() && Boolean(input.name || input.workflowId)
  const [showDefinition, setShowDefinition] = useState(false)

  const options = useMemo<PermissionPromptOption<WorkflowOptionValue>[]>(() => {
    const built: PermissionPromptOption<WorkflowOptionValue>[] = [
      { label: 'Yes, run it', value: 'yes', feedbackConfig: { type: 'accept' } },
    ]
    if (showAlwaysAllow) {
      built.push({
        label: (
          <Text>
            Yes, and don&apos;t ask again for <Text bold>{workflowName}</Text> in{' '}
            <Text bold>{originalCwd}</Text>
          </Text>
        ),
        value: 'yes-always',
      })
    }
    if (definition && !showDefinition) {
      built.push({ label: 'View definition', value: 'view' })
    }
    built.push({ label: 'No', value: 'no', feedbackConfig: { type: 'reject' } })
    return built
  }, [showAlwaysAllow, workflowName, originalCwd, definition, showDefinition])

  const toolAnalyticsContext = useMemo<ToolAnalyticsContext>(
    () => ({
      toolName: sanitizeToolNameForAnalytics(toolUseConfirm.tool.name),
      isMcp: toolUseConfirm.tool.isMcp ?? false,
    }),
    [toolUseConfirm.tool.name, toolUseConfirm.tool.isMcp],
  )

  const handleSelect = useCallback(
    (value: WorkflowOptionValue, feedback?: string) => {
      switch (value) {
        case 'yes':
          toolUseConfirm.onAllow(toolUseConfirm.input, [], feedback)
          onDone()
          break
        case 'yes-always':
          toolUseConfirm.onAllow(toolUseConfirm.input, [
            {
              type: 'addRules',
              rules: [
                { toolName: WORKFLOW_TOOL_NAME, ruleContent: workflowName },
              ],
              behavior: 'allow',
              destination: 'localSettings',
            },
          ])
          onDone()
          break
        case 'view':
          // Stay in the dialog: the whole point is to inspect the definition and then
          // decide, so this must not resolve the permission either way.
          setShowDefinition(true)
          break
        case 'no':
          toolUseConfirm.onReject(feedback)
          onReject()
          onDone()
          break
      }
    },
    [toolUseConfirm, onDone, onReject, workflowName],
  )

  const handleCancel = useCallback(() => {
    toolUseConfirm.onReject()
    onReject()
    onDone()
  }, [toolUseConfirm, onDone, onReject])

  return (
    <PermissionDialog
      title={`${input.mode === 'test' ? 'Test' : 'Run'} workflow "${workflowName}"?`}
      workerBadge={workerBadge}
    >
      <Text>
        A workflow runs Agent nodes in the background. Their tool calls use this
        session&apos;s permission mode and may ask for approval.
      </Text>
      <Box flexDirection="column" paddingX={2} paddingY={1}>
        {description ? <Text dimColor>{description}</Text> : null}
        {phases.length > 0 ? (
          <Box flexDirection="column" marginTop={description ? 1 : 0}>
            <Text dimColor>Agent tasks:</Text>
            {phases.map((phase, index: number) => (
              <Text key={`${phase.title}-${index}`} dimColor>
                {`  ${index + 1}. ${phase.title}`}
                {phase.description ? ` — ${phase.description}` : ''}
              </Text>
            ))}
          </Box>
        ) : null}
        {input.definitionPath ? (
          <Box marginTop={1}>
            <Text dimColor>{`Definition: ${input.definitionPath}`}</Text>
          </Box>
        ) : null}
        {showDefinition && definition ? (
          <Box flexDirection="column" marginTop={1}>
            <Text dimColor>Definition:</Text>
            <Text>{clipDefinition(definition)}</Text>
          </Box>
        ) : null}
      </Box>

      <Box flexDirection="column">
        <PermissionRuleExplanation
          permissionResult={toolUseConfirm.permissionResult}
          toolType="tool"
        />
        <PermissionPrompt
          options={options}
          onSelect={handleSelect}
          onCancel={handleCancel}
          toolAnalyticsContext={toolAnalyticsContext}
        />
      </Box>
    </PermissionDialog>
  )
}

const DEFINITION_PREVIEW_LINES = 60

/** Long definitions are clipped: the dialog must stay smaller than the terminal. */
function clipDefinition(definition: WorkflowDefinitionV3): string {
  const source = JSON.stringify(definition, null, 2)
  const lines = source.split('\n')
  if (lines.length <= DEFINITION_PREVIEW_LINES) return source
  const remaining = lines.length - DEFINITION_PREVIEW_LINES
  return (
    `${lines.slice(0, DEFINITION_PREVIEW_LINES).join('\n')}\n` +
    `… ${remaining} more lines — the full definition is persisted under the session directory`
  )
}

function collectActions(steps: WorkflowNode[]): Array<Extract<WorkflowNode, { type: 'agent' }>> {
  const phases: Array<Extract<WorkflowNode, { type: 'agent' }>> = []
  const visit = (nodes: WorkflowNode[]): void => {
    for (const node of nodes) {
      if (node.type === 'agent') {
        phases.push(node)
      } else if (node.type === 'foreach') {
        visit(node.body.nodes)
      }
    }
  }
  visit(steps)
  return phases
}
