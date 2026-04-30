import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
  SessionRuntimeOptions,
} from '../sessionManager.js'
import { DangerousBackend } from './dangerousBackend.js'
import { DockerBackend } from './dockerBackend.js'
import { ScodeBackend } from './scodeBackend.js'

type RuntimeBackendOptions = {
  engine?: 'legacy' | 'scode'
  scodePath?: string
  defaultRuntime?: SessionRuntimeOptions
  docker?: {
    image?: string
    mode?: 'session' | 'user'
    network?: string
    labels?: Record<string, string>
  }
}

export class RuntimeBackend implements SessionBackend {
  readonly #hostBackend: SessionBackend
  readonly #dockerBackend: SessionBackend
  readonly #scodeBackend: SessionBackend
  readonly #defaultRuntime: SessionRuntimeOptions
  readonly #engine: 'legacy' | 'scode'
  readonly #scodePath?: string

  constructor(options: RuntimeBackendOptions = {}) {
    this.#hostBackend = new DangerousBackend()
    this.#dockerBackend = new DockerBackend(options.docker)
    this.#scodeBackend = new ScodeBackend()
    this.#defaultRuntime = options.defaultRuntime ?? {
      type: 'host',
      engine: 'legacy',
    }
    this.#engine = options.engine || (this.#defaultRuntime.engine as any) || 'legacy'
    this.#scodePath = options.scodePath || this.#defaultRuntime.scodePath
  }

  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
    const runtimeType = options.runtime?.type || this.#defaultRuntime.type || 'host'
    const engine = options.runtime?.engine || this.#engine || 'legacy'

    console.error(`\n[RuntimeBackend] DEBUG INFO:`)
    console.error(`  - Target Engine: ${engine}`)
    console.error(`  - Runtime Type: ${runtimeType}`)
    console.error(`  - Options Engine: ${options.runtime?.engine}`)
    console.error(`  - Default Engine (from options): ${this.#engine}`)
    console.error(`  - Config scodePath: ${this.#scodePath}\n`)

    const mergedOptions: BackendSpawnOptions = {
      ...options,
      runtime: {
        ...this.#defaultRuntime,
        scodePath: this.#scodePath,
        ...options.runtime,
        type: runtimeType,
        engine,
      },
    }

    if (runtimeType === 'docker') {
      return this.#dockerBackend.spawn(mergedOptions)
    }

    if (engine === 'scode') {
      return this.#scodeBackend.spawn(mergedOptions)
    }

    return this.#hostBackend.spawn(mergedOptions)
  }
}
