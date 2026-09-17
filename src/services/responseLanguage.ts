import { getSessionEnvironmentContext } from '../utils/sessionIdContext.js'
import { getInitialSettings } from '../utils/settings/settings.js'
import { MOSS_RUNTIME_ADVANCED_SETTINGS_ENV } from './advancedSettings.js'

function normalizeLanguage(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized ? normalized.slice(0, 80) : undefined
}

function getRuntimeResponseLanguage(): string | undefined {
  const raw =
    getSessionEnvironmentContext()?.[MOSS_RUNTIME_ADVANCED_SETTINGS_ENV] ??
    process.env[MOSS_RUNTIME_ADVANCED_SETTINGS_ENV]
  if (!raw) return undefined

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return normalizeLanguage(parsed.moss_response_language)
  } catch {
    return undefined
  }
}

export function getResponseLanguage(): string | undefined {
  return (
    getRuntimeResponseLanguage() ?? normalizeLanguage(getInitialSettings().language)
  )
}

export function isChineseResponseLanguage(
  language = getResponseLanguage(),
): boolean {
  if (!language) return false
  const normalized = language.trim().toLowerCase()
  return normalized === 'chinese' || normalized === 'zh' || normalized.startsWith('zh-')
}

export function getMemoryLanguageInstruction(): string {
  const language = getResponseLanguage()
  const outputLanguage = language
    ? language
    : 'the language predominantly used by the user in the conversation'
  return `Write all human-readable memory titles, descriptions, headings, index summaries, and body content in ${outputLanguage}. Keep frontmatter keys, memory type values, file paths, code identifiers, commands, and technical terms in their original form.`
}
