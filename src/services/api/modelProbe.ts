import { getAnthropicClient } from './client.js'
import { buildAPIThinkingParam, type ThinkingConfig } from '../../utils/thinking.js'

/** One isolated Messages request. No session, tools, retries or mode fallback. */
export async function probeModelRequest(options: {
  model: string
  thinkingConfig?: ThinkingConfig
  apiKey?: string
  timeoutMs?: number
}) {
  const started = Date.now()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 30_000)
  const config: ThinkingConfig = options.thinkingConfig ?? { type: 'auto' }
  const maxTokens = config.type === 'enabled' ? config.budgetTokens + 256 : 256
  // Test the settings form's snapshot, not a possibly stale desktop disable env.
  const { thinking, hasThinking } = buildAPIThinkingParam(options.model, config, maxTokens, false)
  let status: number | null = null
  try {
    const client = await getAnthropicClient({ model: options.model, maxRetries: 0, source: 'model_configuration_test' })
    const { data: stream, response } = await client.beta.messages.create({
      model: options.model,
      max_tokens: maxTokens,
      stream: true,
      thinking,
      ...(hasThinking ? {} : { temperature: 1 }),
      messages: [{ role: 'user', content: 'Reply with OK only.' }],
    }, { signal: controller.signal, maxRetries: 0 }).withResponse()
    status = response.status
    let stopped = false
    for await (const event of stream) {
      if (event.type === 'message_stop') stopped = true
    }
    if (!stopped) throw new Error('响应流提前结束，请重试。')
    return { ok: true, status, durationMs: Date.now() - started, thinking: config.type, message: '接口已接受当前配置并完成回复。' }
  } catch (error) {
    const apiError = error as { status?: number; message?: string; error?: { message?: string; error?: { message?: string } } }
    const providerMessage = apiError.error?.error?.message ?? apiError.error?.message
    let message = controller.signal.aborted ? '测试超时，请检查接口地址或稍后重试。'
      : typeof providerMessage === 'string' ? providerMessage : apiError.message || String(error)
    if (options.apiKey) message = message.split(options.apiKey).join('[已隐藏]')
    return { ok: false, status: apiError.status ?? status, durationMs: Date.now() - started, thinking: config.type, message: message.slice(0, 2000) }
  } finally {
    clearTimeout(timeout)
  }
}
