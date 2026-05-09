import { spawn } from 'child_process'
import {
  buildSessionEnv,
  resolveScodeCliPath,
} from './backendUtils.js'
import { createAcpBridgeHandle } from './acpBridge.js'
import { syncAllBridgesAsync } from '../../utils/scodeBridge.js'
import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
} from '../sessionManager.js'

export class ScodeBackend implements SessionBackend {
  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
    // Sync skill/agent bridges so scode can discover Moss-installed skills
    try {
      await syncAllBridgesAsync(options.runtime?.configDir)
    } catch (bridgeErr) {
      process.stderr.write(`[ScodeBackend] scode bridge sync warning: ${bridgeErr}\n`)
    }

    const scodePath = resolveScodeCliPath(options.runtime?.scodePath)
    const env = buildSessionEnv(options)

    const model = options.runtime?.model || process.env.MOSS_DEFAULT_MODEL || 'gemini-3-flash-preview'

    const args = [
      'acp',
      '--output-format',
      'json',
      '--permission-mode',
      'danger-full-access',
      '--auth',
      'proxy',
      '--model',
      model,
    ]

    process.stderr.write(`\n[ScodeBackend] Spawning scode engine (ACP Bridge Mode):\n`)
    process.stderr.write(`  Path: ${scodePath}\n`)
    process.stderr.write(`  CWD: ${options.cwd}\n`)
    process.stderr.write(`  Base URL: ${env.ANTHROPIC_BASE_URL}\n`)
    process.stderr.write(`  Auth: ${env.ANTHROPIC_API_KEY ? 'Present' : 'MISSING'}\n\n`)

    const child = spawn(scodePath, args, {
      cwd: options.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    return createAcpBridgeHandle({
      child,
      sessionId: options.sessionId,
      cwd: options.cwd,
      model,
      transcriptPath: (options as any).transcriptPath,
      runtime: {
        type: 'host',
        engine: 'scode',
        configDir: options.runtime?.configDir,
      },
    })
  }
}