export function getModelListUrl(value: string): string

export type ModelCatalog = { models: string[]; contextWindows: Record<string, number> }

export function fetchModelCatalog(options?: {
  url?: string
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<ModelCatalog>

export function fetchModelList(options?: {
  url?: string
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<string[]>
