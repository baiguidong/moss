import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
} from '../backendTypes.js'
import {
  buildSessionEnv,
  createStreamBackendHandle,
  spawnLocalCliProcess,
} from './backendUtils.js'

export class DangerousBackend implements SessionBackend {
  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
    const child = spawnLocalCliProcess(
      {
        ...options,
        runtime: {
          ...options.runtime,
          backend: 'host',
        },
      },
      buildSessionEnv(options, {
        MOSS_SESSION_RUNTIME_TYPE: 'host',
        MOSS_CONFIG_DIR: options.runtime.profileDir,
      }),
    )

    return createStreamBackendHandle(child, options, {
      ...options.runtime,
      backend: 'host',
    })
  }
}
