import { createHash } from 'node:crypto'

export type PromptDiagnosticRow = {
  location: string
  kind: 'system' | 'tool' | 'message'
  name?: string
  characters: number
  bytes: number
  fingerprint: string
  duplicateOf?: string
  truncated?: boolean
}
const record = (value: unknown): value is Record<string, any> => Boolean(value && typeof value === 'object' && !Array.isArray(value))

/** Facts from the captured request only. Does not infer Skill/App provenance from prose. */
export function buildPromptDiagnostics(request: unknown) {
  if (!record(request)) return undefined
  const rows: PromptDiagnosticRow[] = [], seen = new Map<string, string>()
  let remaining = 2_000_000, truncated = false, unmeasuredBlocks = 0
  const add = (text: string, location: string, kind: PromptDiagnosticRow['kind'], name?: string) => {
    if (rows.length >= 256 || remaining <= 0) { truncated = true; return }
    const clipped = text.length > remaining
    const measured = clipped ? text.slice(0, remaining) : text
    remaining -= measured.length; truncated ||= clipped
    const fingerprint = createHash('sha256').update(measured).digest('hex')
    const duplicateOf = !clipped && measured.length >= 80 ? seen.get(fingerprint) : undefined
    if (!clipped && !seen.has(fingerprint)) seen.set(fingerprint, location)
    let characters = 0
    for (const _character of measured) characters++
    rows.push({ location, kind, ...(name ? { name: name.slice(0, 160) } : {}), characters,
      bytes: Buffer.byteLength(measured), fingerprint, ...(duplicateOf ? { duplicateOf } : {}), ...(clipped ? { truncated: true } : {}) })
  }
  const content = (value: unknown, location: string, kind: PromptDiagnosticRow['kind']) => {
    if (typeof value === 'string') add(value, location, kind)
    else if (Array.isArray(value)) {
      for (const [i, block] of value.entries()) {
        if (typeof block === 'string') add(block, `${location}[${i}]`, kind)
        else if (record(block) && ['text', 'input_text', 'output_text'].includes(block.type) && typeof block.text === 'string') add(block.text, `${location}[${i}].text`, kind)
        else unmeasuredBlocks++
      }
    }
  }
  content(request.system, 'system', 'system')
  content(request.instructions, 'instructions', 'system')
  if (Array.isArray(request.tools)) for (const [i, tool] of request.tools.entries()) {
    if (rows.length >= 256 || remaining <= 0) { truncated = true; break }
    const name = record(tool) ? tool.name ?? tool.function?.name : undefined
    add(JSON.stringify(tool), `tools[${i}]`, 'tool', typeof name === 'string' ? name : undefined)
  }
  for (const key of ['messages', 'input']) {
    if (typeof request[key] === 'string') content(request[key], key, 'message')
    else if (Array.isArray(request[key])) for (const [i, message] of request[key].entries()) {
      if (!record(message)) { unmeasuredBlocks++; continue }
      // Chat Completions tool/function results are strings, but they are not
      // ordinary prompt text. Match the nontext handling in Messages/Responses.
      if (message.role === 'tool' || message.role === 'function') { unmeasuredBlocks++; continue }
      if (Array.isArray(message.tool_calls)) unmeasuredBlocks += message.tool_calls.length
      if (message.function_call) unmeasuredBlocks++
      content(message.content, `${key}[${i}].content`, ['system', 'developer'].includes(message.role) ? 'system' : 'message')
      if (message.type && !['message', 'text', 'input_text'].includes(message.type)) unmeasuredBlocks++
    }
  }
  return { version: 1 as const, scope: 'captured_request' as const, metric: 'utf8-content-bytes' as const,
    rows, truncated, unmeasuredBlocks, measuredBytes: rows.reduce((sum, row) => sum + row.bytes, 0) }
}
