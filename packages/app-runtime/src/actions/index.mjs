import {
  APP_ERROR_CODES,
  AppServiceError,
  compileJsonSchema,
  createEnvelope,
  loadJsonSchema,
  validateEnvelope,
} from '../../../app-sdk/src/index.mjs'

export class AppActionBroker {
  constructor(options) {
    this.supervisor = options.supervisor
    this.packageResolver = options.packageResolver
    this.authorize = options.authorize || (() => {})
    this.queues = new Map()
    this.admissions = new Map()
    this.requests = new Map()
    this.pendingCounts = new Map()
    this.validators = new Map()
    this.pendingTotal = 0
    this.maxQueuedPerDeployment = options.maxQueuedPerDeployment || 32
    this.maxQueuedTotal = options.maxQueuedTotal || 512
  }

  async invoke(deployment, actionName, input, options = {}) {
    const requestId = options.requestId === undefined ? null : String(options.requestId)
    if (requestId !== null && (!requestId || requestId.length > 128)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, 'Action request id is invalid')
    }
    try {
      validateEnvelope(createEnvelope('action.invoke', { name: actionName, input }, { id: requestId || undefined }), {
        allowedTypes: ['action.invoke'],
      })
    } catch (error) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `App action input cannot be serialized: ${error.message}`)
    }
    const requestKey = requestId === null ? null : `${deployment.key}:${requestId}`
    if (requestKey && this.requests.has(requestKey)) {
      throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Duplicate action request: ${options.requestId}`)
    }
    const pendingForDeployment = this.pendingCounts.get(deployment.key) || 0
    if (pendingForDeployment >= this.maxQueuedPerDeployment || this.pendingTotal >= this.maxQueuedTotal) {
      throw new AppServiceError(APP_ERROR_CODES.backendUnavailable, 'App action queue limit reached')
    }
    this.pendingCounts.set(deployment.key, pendingForDeployment + 1)
    this.pendingTotal += 1
    const controller = new AbortController()
    let rejectCancellation = null
    const cancellation = new Promise((_, reject) => { rejectCancellation = reject })
    cancellation.catch(() => {})
    if (requestKey) this.requests.set(requestKey, { controller, rejectCancellation })
    const validateRequest = async () => {
      const packageInfo = await this.packageResolver(deployment.appId)
      const action = packageInfo.manifest.backend?.actions.find((item) => item.name === actionName)
      if (!action) throw new AppServiceError(APP_ERROR_CODES.actionNotFound, `Action is not declared: ${actionName}`)
      if (action.inputSchema) {
        const validate = this.validator(packageInfo, actionName, 'input', action.inputSchema)
        if (!validate(input)) {
          throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid input for ${actionName}`, validate.errors)
        }
      }
    }
    const admission = (this.admissions.get(deployment.key) || Promise.resolve()).then(validateRequest, validateRequest)
    const admissionTail = admission.catch(() => {})
    this.admissions.set(deployment.key, admissionTail)
    admissionTail.finally(() => {
      if (this.admissions.get(deployment.key) === admissionTail) this.admissions.delete(deployment.key)
    })
    try {
      await admission
    } catch (error) {
      if (requestKey) this.requests.delete(requestKey)
      this.releaseQueueSlot(deployment.key)
      throw error
    }
    const run = async () => {
      if (controller.signal.aborted) {
        throw new AppServiceError(APP_ERROR_CODES.actionCanceled, 'App action canceled before execution')
      }
      await this.authorize(deployment)
      const activePackage = await this.packageResolver(deployment.appId)
      const activeAction = activePackage.manifest.backend?.actions.find((item) => item.name === actionName)
      if (!activeAction) throw new AppServiceError(APP_ERROR_CODES.actionNotFound, `Action is not declared: ${actionName}`)
      if (activeAction.inputSchema) {
        const validate = this.validator(activePackage, actionName, 'input', activeAction.inputSchema)
        if (!validate(input)) {
          throw new AppServiceError(APP_ERROR_CODES.invalidInput, `Invalid input for ${actionName}`, validate.errors)
        }
      }
      const result = await this.supervisor.invoke(deployment.key, actionName, input, {
        requestId: requestId || undefined,
        timeoutMs: options.timeoutMs ?? activeAction.timeoutMs,
        signal: controller.signal,
      })
      if (activeAction.outputSchema) {
        const validate = this.validator(activePackage, actionName, 'output', activeAction.outputSchema)
        if (!validate(result)) {
          throw new AppServiceError(APP_ERROR_CODES.invalidOutput, `Invalid output from ${actionName}`, validate.errors)
        }
      }
      return result
    }
    const queued = (this.queues.get(deployment.key) || Promise.resolve()).then(run, run)
    const tail = queued.catch(() => {})
    this.queues.set(deployment.key, tail)
    tail.finally(() => {
      if (this.queues.get(deployment.key) === tail) this.queues.delete(deployment.key)
      if (requestKey) this.requests.delete(requestKey)
      this.releaseQueueSlot(deployment.key)
    })
    return requestKey ? Promise.race([queued, cancellation]) : queued
  }

  cancel(deploymentKey, requestId) {
    const request = this.requests.get(`${deploymentKey}:${requestId}`)
    if (!request) return this.supervisor.cancel(deploymentKey, requestId)
    if (!request.controller.signal.aborted) {
      request.controller.abort()
      request.rejectCancellation(new AppServiceError(APP_ERROR_CODES.actionCanceled, 'App action canceled'))
    }
    return true
  }

  releaseQueueSlot(deploymentKey) {
    const count = this.pendingCounts.get(deploymentKey) || 0
    if (count <= 1) this.pendingCounts.delete(deploymentKey)
    else this.pendingCounts.set(deploymentKey, count - 1)
    this.pendingTotal = Math.max(0, this.pendingTotal - 1)
  }

  validator(packageInfo, actionName, direction, schemaPath) {
    const key = `${packageInfo.manifest.id}@${packageInfo.manifest.version}:${actionName}:${direction}:${schemaPath}`
    if (!this.validators.has(key)) {
      this.validators.set(key, compileJsonSchema(
        loadJsonSchema(packageInfo.root, schemaPath, `${actionName} ${direction}`),
      ))
    }
    return this.validators.get(key)
  }
}
