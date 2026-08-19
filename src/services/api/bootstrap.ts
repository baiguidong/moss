import axios from 'axios'
import isEqual from 'lodash-es/isEqual.js'
import { z } from 'zod'
import {
  getMossServerApiUrl,
  getMossServerAuthHeaders,
} from '../../constants/api.js'
import { getGlobalConfig, saveGlobalConfig } from '../../utils/config.js'
import { logForDebugging } from '../../utils/debug.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logError } from '../../utils/log.js'
import { isEssentialTrafficOnly } from '../../utils/privacyLevel.js'
import { getClaudeCodeUserAgent } from '../../utils/userAgent.js'

const bootstrapResponseSchema = lazySchema(() =>
  z.object({
    client_data: z.record(z.unknown()).nullish(),
    additional_model_options: z
      .array(
        z
          .object({
            model: z.string(),
            name: z.string(),
            description: z.string(),
          })
          .transform(({ model, name, description }) => ({
            value: model,
            label: name,
            description,
          })),
      )
      .nullish(),
  }),
)

type BootstrapResponse = z.infer<ReturnType<typeof bootstrapResponseSchema>>

async function fetchBootstrapAPI(): Promise<BootstrapResponse | null> {
  if (isEssentialTrafficOnly()) {
    logForDebugging('[Bootstrap] Skipped: Nonessential traffic disabled')
    return null
  }

  const endpoint = getMossServerApiUrl('/api/v1/bootstrap')
  const serverAuthHeaders = getMossServerAuthHeaders()
  if (!endpoint || Object.keys(serverAuthHeaders).length === 0) {
    logForDebugging('[Bootstrap] Skipped: Moss server not configured')
    return null
  }

  try {
    logForDebugging('[Bootstrap] Fetching')
    const response = await axios.get<unknown>(endpoint, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': getClaudeCodeUserAgent(),
        ...serverAuthHeaders,
      },
      timeout: 5000,
    })
    const parsed = bootstrapResponseSchema().safeParse(response.data)
    if (!parsed.success) {
      logForDebugging(
        `[Bootstrap] Response failed validation: ${parsed.error.message}`,
      )
      return null
    }
    logForDebugging('[Bootstrap] Fetch ok')
    return parsed.data
  } catch (error) {
    logForDebugging(
      `[Bootstrap] Fetch failed: ${axios.isAxiosError(error) ? (error.response?.status ?? error.code) : 'unknown'}`,
    )
    throw error
  }
}

/**
 * Fetch bootstrap data from the API and persist to disk cache.
 */
export async function fetchBootstrapData(): Promise<void> {
  try {
    const response = await fetchBootstrapAPI()
    if (!response) return

    const clientData = response.client_data ?? null
    const additionalModelOptions = response.additional_model_options ?? []

    // Only persist if data actually changed — avoids a config write on every startup.
    const config = getGlobalConfig()
    if (
      isEqual(config.clientDataCache, clientData) &&
      isEqual(config.additionalModelOptionsCache, additionalModelOptions)
    ) {
      logForDebugging('[Bootstrap] Cache unchanged, skipping write')
      return
    }

    logForDebugging('[Bootstrap] Cache updated, persisting to disk')
    saveGlobalConfig(current => ({
      ...current,
      clientDataCache: clientData,
      additionalModelOptionsCache: additionalModelOptions,
    }))
  } catch (error) {
    logError(error)
  }
}
