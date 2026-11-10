import { resolveContextWindowForModel } from '../context.js'
import { runWithSessionApiOverrides } from '../sessionApiOverrides.js'
import { normalizeMossBaseUrl } from './modelBaseUrl.js'

/** Use the query runtime's provider cache and context policy for desktop UI. */
export async function resolveDesktopModelContext(options: {
  model: string
  url?: string
  apiKey?: string
  declaredContextWindows?: Record<string, number>
}) {
  const model = options.model.trim()
  if (!model) return null
  return runWithSessionApiOverrides({
    mossModel: model,
    mossBaseUrl: normalizeMossBaseUrl(options.url),
    mossAuthToken: options.apiKey?.trim() || undefined,
    declaredContextWindows: options.declaredContextWindows,
  }, async () => {
    return {
      model,
      ...resolveContextWindowForModel(model),
    }
  })
}
