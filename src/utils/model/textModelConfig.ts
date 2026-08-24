import type { SettingsJson } from '../settings/types.js'

export type TextModelConfig = {
  baseUrl?: string
  apiKey?: string
  model?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function recordField(
  source: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return isRecord(source[key]) ? source[key] : {}
}

function stringField(
  source: Record<string, unknown>,
  key: string,
): string | undefined {
  return typeof source[key] === 'string' ? source[key].trim() : undefined
}

function firstNonEmptyString(
  ...values: Array<string | undefined>
): string | undefined {
  return values.find(value => typeof value === 'string' && value.length > 0)
}

export function getTextModelConfig(
  settings: SettingsJson | null | undefined,
): TextModelConfig {
  const source = isRecord(settings) ? settings : {}
  const text = recordField(recordField(source, 'models'), 'text')

  return {
    baseUrl: firstNonEmptyString(
      stringField(text, 'baseUrl'),
      stringField(source, 'url'),
    ),
    apiKey: firstNonEmptyString(
      stringField(text, 'apiKey'),
      stringField(source, 'apiKey'),
    ),
    model: firstNonEmptyString(
      stringField(source, 'model'),
      stringField(text, 'model'),
    ),
  }
}
