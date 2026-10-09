import { randomUUID } from 'node:crypto'
import { abortError, requestTimeout } from '../../../app-sdk/src/errors.mjs'
import { APP_ERROR_CODES, AppServiceError, createEnvelope, validateEnvelope } from '../../../app-sdk/src/protocol/index.mjs'

/** Admission, deadlines and lifecycle cancellation shared by UI and Backend Host calls. */
export class HostRequests {
  constructor({ timeoutMs = 30_000, maxTimeoutMs = 300_000, maxPending = 512, maxPerRuntime = 32 } = {}) {
    Object.assign(this, { timeoutMs, maxTimeoutMs, maxPending, maxPerRuntime })
    this.pending = new Map()
  }

  async run(request, operation) {
    const timeoutMs = requestTimeout(request.timeoutMs, this.timeoutMs, this.maxTimeoutMs)
    const requestId = request.requestId ?? randomUUID()
    if (typeof requestId !== 'string' || !requestId || requestId.length > 128) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Invalid Host request id')
    }
    const key = JSON.stringify([request.owner?.key, request.key, request.surface, request.sourceId, requestId])
    if (this.pending.has(key)) throw new AppServiceError(APP_ERROR_CODES.conflict, 'Duplicate Host request id')
    if (this.pending.size >= this.maxPending || [...this.pending.values()].filter(r => r.key === request.key && r.owner?.key === request.owner?.key).length >= this.maxPerRuntime) {
      throw new AppServiceError(APP_ERROR_CODES.resourceExhausted, 'Host request limit reached')
    }
    try { validateEnvelope(createEnvelope('host.request', { protocol: request.protocol, method: request.method, input: request.input }, { id: requestId })) }
    catch (error) { throw new AppServiceError(APP_ERROR_CODES.invalidInput, error.message) }
    const controller = new AbortController()
    const abort = () => controller.abort(abortError(request.signal))
    if (request.signal?.aborted) abort()
    controller.signal.throwIfAborted()
    request.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(new AppServiceError(APP_ERROR_CODES.hostTimeout, 'Host request timed out')), timeoutMs)
    timer.unref?.()
    const current = { ...request, requestId, timeoutMs, signal: controller.signal, controller }
    this.pending.set(key, current)
    let onAbort
    const cancelled = new Promise((_, reject) => {
      onAbort = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', onAbort, { once: true })
    })
    const work = Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return operation(current)
    }).then(result => {
      try { validateEnvelope(createEnvelope('host.response', { result }, { id: requestId })) }
      catch (error) { throw new AppServiceError(APP_ERROR_CODES.hostProtocol, `Invalid Host response: ${error.message}`) }
      return result
    }).finally(() => {
      // Keep capacity occupied until the handler has actually stopped.
      this.pending.delete(key)
    })
    try { return await Promise.race([work, cancelled]) }
    finally {
      clearTimeout(timer)
      controller.signal.removeEventListener('abort', onAbort)
      request.signal?.removeEventListener('abort', abort)
    }
  }

  cancelWhere(predicate, message = 'Host request owner stopped') {
    for (const request of this.pending.values()) if (predicate(request)) {
      request.controller.abort(new AppServiceError(APP_ERROR_CODES.actionCanceled, message))
    }
  }
}
