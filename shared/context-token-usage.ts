export type ContextTokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens: number
  cache_read_input_tokens: number
}

export function getContextUsageFromUsage(
  usage: Partial<ContextTokenUsage> & { iterations?: unknown },
): ContextTokenUsage {
  const contextUsage = {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
  }
  if (
    contextUsage.input_tokens + contextUsage.cache_creation_input_tokens +
      contextUsage.cache_read_input_tokens === 0 ||
    !Array.isArray(usage.iterations)
  ) return contextUsage
  let iteration: Record<string, unknown> | undefined
  for (let index = usage.iterations.length - 1; index >= 0; index--) {
    const candidate = usage.iterations[index] as Record<string, unknown> | null
    if (candidate?.type !== 'advisor_message' && candidate?.type !== 'compaction') {
      iteration = candidate ?? undefined
      break
    }
  }
  const fields = ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens'] as const
  if (
    !iteration ||
    (iteration.type !== 'message' && iteration.type !== 'fallback_message') ||
    !fields.every(field => typeof iteration[field] === 'number' &&
      Number.isFinite(iteration[field]) && Number(iteration[field]) >= 0) ||
    Number(iteration.input_tokens) + Number(iteration.cache_creation_input_tokens) +
      Number(iteration.cache_read_input_tokens) === 0
  ) return contextUsage
  return {
    input_tokens: Number(iteration.input_tokens),
    output_tokens: Number(iteration.output_tokens),
    cache_creation_input_tokens: Number(iteration.cache_creation_input_tokens),
    cache_read_input_tokens: Number(iteration.cache_read_input_tokens),
  }
}
