const DEFAULT_API_BASE_URL = 'https://api.anthropic.com'

export function getApiBaseUrl(): string {
  return (process.env.MOSS_BASE_URL || DEFAULT_API_BASE_URL).replace(/\/$/, '')
}

export const CLAUDE_AI_ORIGIN = 'https://claude.ai'
