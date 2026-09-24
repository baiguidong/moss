import { randomUUID } from 'crypto'
import Ajv2020 from 'ajv/dist/2020.js'
import { z } from 'zod/v4'
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
  appId: string
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
  if (
    !descriptor.inputSchemaDocument
    || descriptor.inputSchemaDocument.type !== 'object'
  ) {
    throw new Error(`App Tool contribution input schema must describe an object: ${descriptor.id}`)
  }

  const ajv = new Ajv2020({ allErrors: true, strict: false })
  const validate = ajv.compile(descriptor.inputSchemaDocument)
  const appLabel = descriptor.appDisplayName?.trim() || descriptor.appId
  const isReadOnly = descriptor.effect === 'read'
  const isDestructive = descriptor.effect === 'destructive'

  return buildTool({
    name: descriptor.name,
    supportedEnvironments: ['desktop'],
    searchHint: `${descriptor.title} from ${appLabel}`.slice(0, 160),
    maxResultSizeChars: 100_000,
    deferLoading: true,
    async description() {
      return descriptor.description
    },
    async prompt() {
      return `${descriptor.description}\n\nThis tool is provided by the installed Moss App "${appLabel}".`
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
      if (isReadOnly) return { behavior: 'allow' as const, updatedInput: input }
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
    async call(input, context: ToolUseContext): Promise<{ data: unknown }> {
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
