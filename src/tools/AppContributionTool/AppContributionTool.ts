import { randomUUID } from 'crypto'
import Ajv2020 from 'ajv/dist/2020.js'
import { z } from 'zod/v4'
import { validateAppToolInputSchema } from '../../../packages/app-sdk/src/index.mjs'
import {
  buildTool,
  getGlobalAppEventBridge,
  type MossAppEventResult,
  type Tool,
  type ToolInputJSONSchema,
  type ToolUseContext,
} from '../../Tool.js'
import { jsonStringify } from '../../utils/slowOperations.js'

export type AppToolEffect = 'read' | 'write' | 'destructive'

export type AppToolContributionDescriptor = {
  id: string
  name: string
  title: string
  description: string
  instructionsText?: string
  hostPermissionManaged?: boolean
  appId: string
  toolScope?: 'global' | 'session'
  toolSelection?: 'app' | 'services'
  serviceId?: string
  appDisplayName?: string
  effect: AppToolEffect
  inputSchemaDocument: Record<string, unknown>
  outputSchemaDocument?: Record<string, unknown>
}

const permissiveObjectSchema = z.object({}).passthrough()

function formatValidationErrors(errors: unknown): string {
  if (!Array.isArray(errors) || errors.length === 0) return 'input does not match the declared schema'
  return errors
    .map((entry) => {
      const error = entry as { instancePath?: string; message?: string }
      return `${error.instancePath || 'root'} ${error.message || 'is invalid'}`
    })
    .join('; ')
}

function mapResult(content: unknown, toolUseID: string) {
  const result = content as { format?: string; content?: any[]; isError?: boolean } | null
  if (result?.format === 'moss.tool-result/v1' && Array.isArray(result.content)) {
    let imageBytes = 0
    const blocks = result.content.map(item => {
      if (item.type === 'text' && typeof item.text === 'string') return { type: 'text' as const, text: item.text }
      if (item.type === 'image' && ['image/png','image/jpeg','image/webp','image/gif'].includes(item.mimeType) && typeof item.data === 'string') {
        imageBytes += item.data.length
        if (imageBytes > 24 * 1024 * 1024) throw new Error('App tool images exceed the result limit')
        return { type: 'image' as const, source: { type: 'base64' as const, media_type: item.mimeType, data: item.data } }
      }
      throw new Error('Invalid App tool result content block')
    })
    return { tool_use_id: toolUseID, type: 'tool_result' as const, content: blocks, ...(result.isError ? { is_error: true } : {}) }
  }
  let serialized = 'null'
  try {
    serialized = jsonStringify(content) ?? 'null'
  } catch {
    serialized = String(content)
  }
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: serialized,
  }
}

export function createAppContributionTool(
  descriptor: AppToolContributionDescriptor,
): Tool {
  if (!descriptor?.id || !descriptor.name || !descriptor.appId) {
    throw new Error('App Tool contribution is missing its identity')
  }
  if (!['read', 'write', 'destructive'].includes(descriptor.effect)) {
    throw new Error(`App Tool contribution has an invalid effect: ${descriptor.id}`)
  }
  validateAppToolInputSchema(descriptor.inputSchemaDocument, `App Tool ${descriptor.id} input schema`)

  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile(descriptor.inputSchemaDocument)
  const appLabel = descriptor.appDisplayName?.trim() || descriptor.appId
  const isReadOnly = descriptor.effect === 'read'
  const isDestructive = descriptor.effect === 'destructive'

  return buildTool({
    name: descriptor.name,
    appInfo: { appId: descriptor.appId, toolScope: descriptor.toolScope || 'session', toolSelection: descriptor.toolSelection, serviceId: descriptor.serviceId },
    supportedEnvironments: ['desktop'],
    requiresDesktop: descriptor.hostPermissionManaged === true,
    requiresInteractiveMainSession: descriptor.hostPermissionManaged === true,
    searchHint: `${descriptor.title} from ${appLabel}`.slice(0, 160),
    maxResultSizeChars: descriptor.hostPermissionManaged ? 120_000 : 100_000,
    deferLoading: true,
    async description() {
      return descriptor.description
    },
    async prompt() {
      return `${descriptor.instructionsText || descriptor.description}\n\nThis tool is provided by the installed Moss App "${appLabel}".`
    },
    get inputSchema() {
      return permissiveObjectSchema
    },
    inputJSONSchema: descriptor.inputSchemaDocument as ToolInputJSONSchema,
    userFacingName() {
      return descriptor.title
    },
    isConcurrencySafe() {
      return isReadOnly
    },
    isReadOnly() {
      return isReadOnly
    },
    isDestructive() {
      return isDestructive
    },
    interruptBehavior() {
      return 'cancel'
    },
    async validateInput(input) {
      return validate(input)
        ? { result: true as const }
        : {
            result: false as const,
            message: formatValidationErrors(validate.errors),
            errorCode: 9,
          }
    },
    async checkPermissions(input) {
      if (isReadOnly || descriptor.hostPermissionManaged) return { behavior: 'allow' as const, updatedInput: input }
      return {
        behavior: 'ask' as const,
        message: isDestructive
          ? `Allow ${appLabel} to perform the destructive action “${descriptor.title}”?`
          : `Allow ${appLabel} to perform “${descriptor.title}”?`,
        ...(!isDestructive ? {
          suggestions: [{
            type: 'addRules' as const,
            destination: 'userSettings' as const,
            rules: [{ toolName: descriptor.name }],
            behavior: 'allow' as const,
          }],
        } : {}),
      }
    },
    async call(input, context: ToolUseContext, canUseTool, parentMessage): Promise<{ data: unknown }> {
      if (descriptor.hostPermissionManaged && context.agentId) throw new Error('Native desktop control is reserved for the interactive main session')
      const emitAppEvent = context.emitAppEvent ?? getGlobalAppEventBridge()
      if (!emitAppEvent) {
        throw new Error(`Moss App Tool is unavailable because its Host bridge is not connected: ${descriptor.id}`)
      }
      const result: MossAppEventResult = await emitAppEvent({
        type: 'app_tool_invoke',
        input: {
          contributionId: descriptor.id,
          input,
          requestId: `tool:${context.toolUseId || randomUUID()}`,
        },
        signal: context.abortController.signal,
        authorizeCommand: async (command: string) => {
          if (!canUseTool || !parentMessage) throw new Error('Ordinary Agent command authorization is unavailable')
          const { BashTool } = await import('../BashTool/BashTool.js')
          const commandInput = { command, description: 'Build or verify the bound App source snapshot' }
          const validation = await BashTool.validateInput?.(commandInput, context)
          if (validation && !validation.result) throw new Error(validation.message)
          const decision = await canUseTool(BashTool, commandInput, context, parentMessage, randomUUID())
          if (decision.behavior !== 'allow') throw new Error('App command was denied by the ordinary Agent permission policy')
          if (decision.updatedInput && (decision.updatedInput as { command?: string }).command !== command) {
            throw new Error('Command changed during authorization; prepare a new build request')
          }
        },
      })
      if (!result.ok) throw new Error(result.error)
      return { data: result.result }
    },
    mapToolResultToToolResultBlockParam: mapResult,
  }) as Tool
}

export function createAppContributionTools(
  descriptors: readonly AppToolContributionDescriptor[] = [],
): Tool[] {
  const names = new Set<string>()
  return descriptors.map((descriptor) => {
    if (names.has(descriptor.name)) {
      throw new Error(`Duplicate App Tool name: ${descriptor.name}`)
    }
    names.add(descriptor.name)
    return createAppContributionTool(descriptor)
  })
}
