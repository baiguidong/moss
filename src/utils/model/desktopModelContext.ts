import { getSdkBetas } from '../../bootstrap/state.js'
import { resolveContextWindowForModel } from '../context.js'
import { runWithSessionApiOverrides } from '../sessionApiOverrides.js'
import { normalizeMossBaseUrl } from './modelBaseUrl.js'
import { loadModelCapabilities } from './modelCapabilities.js'

/** Use the query runtime's provider cache and context policy for desktop UI. */
export async function resolveDesktopModelContext(options: {
  model: string
  url?: string
  apiKey?: string
}) {
  const model = options.model.trim()
  if (!model) return null
  return runWithSessionApiOverrides({
    mossModel: model,
    mossBaseUrl: normalizeMossBaseUrl(options.url),
    mossAuthToken: options.apiKey?.trim() || undefined,
  }, async () => {
    await loadModelCapabilities(model)
    return {
      model,
      ...resolveContextWindowForModel(model, getSdkBetas()),
    }
  })
}
