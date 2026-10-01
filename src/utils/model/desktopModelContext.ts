import { getSdkBetas } from '../../bootstrap/state.js'
import { getContextWindowForModel, MODEL_CONTEXT_WINDOW_DEFAULT } from '../context.js'
import { runWithSessionApiOverrides } from '../sessionApiOverrides.js'
import { normalizeMossBaseUrl } from './modelBaseUrl.js'
import { getModelCapability, loadModelCapabilities } from './modelCapabilities.js'

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
    const contextWindow = getContextWindowForModel(model, getSdkBetas())
    const capability = getModelCapability(model)
    return {
      model,
      contextWindow,
      // Make the runtime fallback explicit when a provider omits its limits.
      isDefault: contextWindow === MODEL_CONTEXT_WINDOW_DEFAULT &&
        !(capability?.max_input_tokens && capability.max_input_tokens >= 100_000),
    }
  })
}
