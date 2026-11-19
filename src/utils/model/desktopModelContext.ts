import { resolveContextWindowForModel } from '../context.js'
import { runWithSessionApiOverrides } from '../sessionApiOverrides.js'
import { normalizeMossBaseUrl } from './modelBaseUrl.js'

/** Use the query runtime's provider cache and context policy for desktop UI. */
export async function resolveDesktopModelContext(options: {
  model: string
  url?: string
  apiKey?: string
  contextWindowLimit?: number
  declaredContextWindows?: Record<string, number>
}) {
  const model = options.model.trim()
  if (!model) return null
  return runWithSessionApiOverrides({
    mossModel: model,
    mossBaseUrl: normalizeMossBaseUrl(options.url),
    mossAuthToken: options.apiKey?.trim() || undefined,
    contextWindowLimit: options.contextWindowLimit,
    declaredContextWindows: options.declaredContextWindows,
  }, async () => {
    return {
      model,
      ...resolveContextWindowForModel(model),
    }
  })
}
