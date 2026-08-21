import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
} from '../backendTypes.js'
import { DirectEmbeddedBackend } from './directEmbeddedBackend.js'
import { DockerBackend } from './dockerBackend.js'

type RuntimeBackendOptions = {
  docker?: {
    network?: string
    labels?: Record<string, string>
  }
}

export class RuntimeBackend implements SessionBackend {
  readonly #hostBackend: SessionBackend
  readonly #dockerBackend: SessionBackend

  constructor(options: RuntimeBackendOptions = {}) {
    this.#hostBackend = new DirectEmbeddedBackend()
    this.#dockerBackend = new DockerBackend(options.docker)
  }

  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
    if (options.runtime.backend === 'docker') {
      return this.#dockerBackend.spawn(options)
    }
    return this.#hostBackend.spawn(options)
  }
}
