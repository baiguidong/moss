import { Ajv } from 'ajv'

const MAX_STRUCTURED_TEXT_CHARS = 100_000

export type StructuredTextParseResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string }

/**
 * Strict fallback for runtimes that return the requested JSON object as final
 * text instead of invoking the synthetic output tool.
 * Surrounding prose is intentionally rejected.
 */
export function parseStructuredAgentText(
  text: string,
  schema: unknown,
): StructuredTextParseResult {
  if (text.length > MAX_STRUCTURED_TEXT_CHARS) {
    return { ok: false, error: 'structured JSON text is too large' }
  }
  let source = text.trim()
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(source)
  if (fenced) source = fenced[1]!.trim()
  if (!source.startsWith('{') || !source.endsWith('}')) {
    return { ok: false, error: 'final response is not a standalone JSON object' }
  }

  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    return {
      ok: false,
      error: `final response is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: 'structured output must be a JSON object' }
  }

  try {
    const ajv = new Ajv({ allErrors: true, strict: false })
    const validate = ajv.compile(schema as object | boolean)
    if (!validate(value)) {
      return {
        ok: false,
        error: `structured JSON does not match the schema: ${ajv.errorsText(validate.errors)}`,
      }
    }
  } catch (error) {
    return {
      ok: false,
      error: `structured output schema is invalid: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
  return { ok: true, value }
}
