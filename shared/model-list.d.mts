export function getModelListUrl(value: string): string

export function fetchModelList(options?: {
  url?: string
  apiKey?: string
  timeoutMs?: number
  fetchImpl?: typeof fetch
}): Promise<string[]>
