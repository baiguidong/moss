import { dirname, join } from 'path'
import { stat } from 'fs/promises'
import { errorMessage, isENOENT, readJSONLFile } from './lib/json.js'
import {
  collectJsonlFilesRecursive,
  isTranscriptMessage,
  SYNTHETIC_MODEL,
  type TranscriptEntry,
} from './lib/transcript.js'

export type SessionUsageSummary = {
  inputTokens: number
  outputTokens: number
  cacheReadInputTokens: number
  cacheCreationInputTokens: number
  totalTokens: number
  costUSD: number
  webSearchRequests: number
  modelUsage: Record<string, {
    inputTokens: number
    outputTokens: number
    cacheReadInputTokens: number
    cacheCreationInputTokens: number
    webSearchRequests: number
    costUSD: number
  }>
  assistantMessageCount: number
  filesRead: number
  truncatedFiles: string[]
  includesSubagents: boolean
  subagentTranscriptCount: number
}

type Usage = NonNullable<NonNullable<TranscriptEntry['message']>['usage']>

function modelCosts(model: string, usage: Usage) {
  const normalized = model.toLowerCase()
  if (normalized.includes('haiku-3-5') || normalized.includes('3-5-haiku')) {
    return [0.8, 4, 1, 0.08] as const
  }
  if (normalized.includes('haiku')) return [1, 5, 1.25, 0.1] as const
  if (normalized.includes('opus-4-6') && (usage as { speed?: string }).speed === 'fast') {
    return [30, 150, 37.5, 3] as const
  }
  if (normalized.includes('opus-4-5') || normalized.includes('opus-4-6')) {
    return [5, 25, 6.25, 0.5] as const
  }
  if (normalized.includes('opus')) return [15, 75, 18.75, 1.5] as const
  if (normalized.includes('sonnet')) return [3, 15, 3.75, 0.3] as const
  return [5, 25, 6.25, 0.5] as const
}

export function calculateUSDCost(model: string, usage: Usage): number {
  const [input, output, cacheWrite, cacheRead] = modelCosts(model, usage)
  return (
    ((usage.input_tokens ?? 0) * input +
      (usage.output_tokens ?? 0) * output +
      (usage.cache_creation_input_tokens ?? 0) * cacheWrite +
      (usage.cache_read_input_tokens ?? 0) * cacheRead) /
      1_000_000 +
    (usage.server_tool_use?.web_search_requests ?? 0) * 0.01
  )
}

function emptySummary(): SessionUsageSummary {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    totalTokens: 0,
    costUSD: 0,
    webSearchRequests: 0,
    modelUsage: {},
    assistantMessageCount: 0,
    filesRead: 0,
    truncatedFiles: [],
    includesSubagents: false,
    subagentTranscriptCount: 0,
  }
}

async function accumulateFile(
  filePath: string,
  summary: SessionUsageSummary,
  includeSidechains: boolean,
): Promise<void> {
  try {
    if ((await stat(filePath)).size > 100 * 1024 * 1024) {
      summary.truncatedFiles.push(filePath)
    }
  } catch {}

  const entries = await readJSONLFile<TranscriptEntry>(filePath)
  summary.filesRead += 1
  for (const entry of entries) {
    if (!isTranscriptMessage(entry) || entry.type !== 'assistant') continue
    if (!includeSidechains && entry.isSidechain) continue
    const usage = entry.message?.usage
    const model = entry.message?.model || 'unknown'
    if (!usage || model === SYNTHETIC_MODEL) continue

    const inputTokens = usage.input_tokens ?? 0
    const outputTokens = usage.output_tokens ?? 0
    const cacheReadInputTokens = usage.cache_read_input_tokens ?? 0
    const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0
    const webSearchRequests = usage.server_tool_use?.web_search_requests ?? 0
    const costUSD = calculateUSDCost(model, usage)
    summary.inputTokens += inputTokens
    summary.outputTokens += outputTokens
    summary.cacheReadInputTokens += cacheReadInputTokens
    summary.cacheCreationInputTokens += cacheCreationInputTokens
    summary.totalTokens += inputTokens + outputTokens + cacheReadInputTokens + cacheCreationInputTokens
    summary.webSearchRequests += webSearchRequests
    summary.costUSD += costUSD
    summary.assistantMessageCount += 1

    const perModel = (summary.modelUsage[model] ??= {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadInputTokens: 0,
      cacheCreationInputTokens: 0,
      webSearchRequests: 0,
      costUSD: 0,
    })
    perModel.inputTokens += inputTokens
    perModel.outputTokens += outputTokens
    perModel.cacheReadInputTokens += cacheReadInputTokens
    perModel.cacheCreationInputTokens += cacheCreationInputTokens
    perModel.webSearchRequests += webSearchRequests
    perModel.costUSD += costUSD
  }
}

export async function getSessionUsageSummaryFromTranscriptPath(input: {
  transcriptSessionId: string
  mainTranscriptPath: string
  subagentsDir?: string
}): Promise<SessionUsageSummary | null> {
  const summary = emptySummary()
  try {
    await accumulateFile(input.mainTranscriptPath, summary, false)
  } catch (error) {
    if (isENOENT(error)) return null
    throw new Error(`Failed to read session transcript ${input.mainTranscriptPath}: ${errorMessage(error)}`)
  }

  const subagentsDir = input.subagentsDir ?? join(
    dirname(input.mainTranscriptPath),
    input.transcriptSessionId,
    'subagents',
  )
  const subagentFiles = await collectJsonlFilesRecursive(subagentsDir)
  summary.subagentTranscriptCount = subagentFiles.length
  summary.includesSubagents = subagentFiles.length > 0
  for (const filePath of subagentFiles) await accumulateFile(filePath, summary, true)
  return summary
}
