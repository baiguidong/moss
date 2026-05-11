import { spawn } from 'child_process'
import {
  buildSessionEnv,
  resolveScodeCliPath,
} from './backendUtils.js'
import { createAcpBridgeHandle } from './acpBridge.js'
import { syncWorkspaceSkills } from '../../utils/scodeBridge.js'
import type {
  BackendHandle,
  BackendSpawnOptions,
  SessionBackend,
} from '../sessionManager.js'

export class ScodeBackend implements SessionBackend {
  async spawn(options: BackendSpawnOptions): Promise<BackendHandle> {
    const scodePath = resolveScodeCliPath(options.runtime?.scodePath)
    const env = buildSessionEnv(options)
    const model = options.runtime?.model || process.env.MOSS_DEFAULT_MODEL || 'gemini-3-flash-preview'

    // 同步技能到工作空间目录（新方案）
    // 在工作空间的 .nexus/sudocode/skills/ 目录创建符号链接
    try {
      await syncWorkspaceSkills(options.cwd, options.enabledSkillNames)
      process.stderr.write(`[ScodeBackend] Workspace skills synced to ${options.cwd}/.nexus/sudocode/skills/\n`)
    } catch (err) {
      process.stderr.write(`[ScodeBackend] Workspace skills sync warning: ${err}\n`)
    }

    const args = [
      'acp',
      '--output-format', 'json',
      '--permission-mode', 'danger-full-access',
      '--auth', 'proxy',
      '--model', model,
    ]

    process.stderr.write(`\n[ScodeBackend] Spawning scode engine (ACP Bridge Mode):\n`)
    process.stderr.write(`  Path: ${scodePath}\n`)
    process.stderr.write(`  CWD: ${options.cwd}\n`)
    process.stderr.write(`  Model: ${model}\n`)
    process.stderr.write(`  Assistant: ${options.assistantName || 'default'}\n`)
    process.stderr.write(`  Enabled Skills: ${options.enabledSkillNames?.join(', ') || 'all'}\n\n`)

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
      // 新方案：传递智能体名称和启用的技能列表
      assistantName: options.assistantName,
      enabledSkillNames: options.enabledSkillNames,
      runtime: {
        type: 'host',
        engine: 'scode',
        configDir: options.runtime?.configDir,
      },
    })
  }
}
