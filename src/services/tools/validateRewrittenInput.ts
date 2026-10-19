import { z } from 'zod/v4'
import type { Tool, ToolUseContext } from '../../Tool.js'
import { formatZodValidationError } from '../../utils/toolErrors.js'

/** Validate rewrites before permission checks or execution, never silently strip keys. */
export async function validateRewrittenInput(
  tool: Tool,
  input: Record<string, unknown>,
  context: ToolUseContext,
  allowPermissionSedEdit = false,
): Promise<Record<string, unknown>> {
  context.abortController.signal.throwIfAborted()
  let candidate = input
  let sedEdit: { filePath: string; newContent: string } | undefined
  if (tool.name === 'Bash' && input && '_simulatedSedEdit' in input) {
    if (!allowPermissionSedEdit) throw new Error('InputValidationError: _simulatedSedEdit is reserved for the permission UI')
    sedEdit = z.strictObject({ filePath: z.string(), newContent: z.string() }).parse(input._simulatedSedEdit)
    const { _simulatedSedEdit, ...rest } = input
    candidate = rest
  }
  const schema = tool.inputSchema
  const strict = 'strict' in schema && typeof schema.strict === 'function' ? schema.strict() : schema
  const result = strict.safeParse(candidate)
  if (!result.success) throw new Error(`InputValidationError: ${formatZodValidationError(tool.name, result.error)}`)
  const checked = await tool.validateInput?.(result.data, context)
  if (checked?.result === false) throw new Error(`InputValidationError: ${checked.message}`)
  context.abortController.signal.throwIfAborted()
  return sedEdit ? { ...result.data, _simulatedSedEdit: sedEdit } : result.data
}
