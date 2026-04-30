import { spawn } from 'child_process'
import { createInterface } from 'readline'
import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import {
  buildSessionEnv,
  resolveScodeCliPath,
} from './backendUtils.js'
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

    if (!child.stdin || !child.stdout) {
      throw new Error('Failed to start scode process pipes')
    }

    const stdoutListeners = new Set<(line: string) => void>()
    const stderrListeners = new Set<(line: string) => void>()
    const exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()

    // State for ACP tracking
    let rpcId = 1
    let acpSessionId: string | null = null
    const pendingStdin: string[] = []
    let currentAssistantText = ''
    let lastPersistedUuid: string | null = null

    const writeTranscript = async (event: any) => {
      const transcriptPath = (options as any).transcriptPath
      if (!transcriptPath) return
      try {
        await mkdir(dirname(transcriptPath), { recursive: true })
        await appendFile(transcriptPath, JSON.stringify(event) + '\n', 'utf8')
      } catch (e: any) {
        process.stderr.write(`[ScodeBackend] TRANSCRIPT WRITE ERROR: ${e.message}\n`)
      }
    }

    const sendRpc = (method: string, params: any, customId?: string) => {
      const id = customId || `m-${rpcId++}`
      const msg = { jsonrpc: '2.0', id, method, params }
      const raw = JSON.stringify(msg) + '\n'
      process.stderr.write(`[ScodeBackend] Sending RPC: ${raw}`)
      child.stdin!.write(raw)
    }

    const flushPending = () => {
       if (!acpSessionId) return
       while (pendingStdin.length > 0) {
          const data = pendingStdin.shift()!
          // Translate Moss Stdin to ACP Prompt
          let cleanText = data;
          let userUuid = randomUUID();
          try {
             const parsed = JSON.parse(data);
             if (parsed.type === 'user') {
                cleanText = parsed.message?.content || data;
                userUuid = parsed.uuid || userUuid;
             }
          } catch {
             cleanText = data;
          }

          const userEvent = {
            type: 'user',
            sessionId: options.sessionId,
            uuid: userUuid,
            parentUuid: lastPersistedUuid,
            isSidechain: false,
            timestamp: new Date().toISOString(),
            cwd: options.cwd,
            userType: 'external',
            version: 'unknown',
            message: {
              role: 'user',
              content: cleanText.trim()
            }
          }
          void writeTranscript(userEvent)
          lastPersistedUuid = userUuid

          sendRpc('session/prompt', {
            sessionId: acpSessionId,
            prompt: [{ type: 'text', text: cleanText.trim() }]
          })
       }
    }

    // RAW STDOUT DEBUGGING
    let stdoutBuffer = ''
    child.stdout.on('data', (data: Buffer) => {
       const chunk = data.toString('utf8')
       // DEBUG: Log every raw chunk to see usage info
       process.stderr.write(`[ScodeBackend] RAW STDOUT: ${chunk}\n`)
       stdoutBuffer += chunk

       while (true) {
          const newlineIdx = stdoutBuffer.indexOf('\n')
          if (newlineIdx === -1) break

          const line = stdoutBuffer.slice(0, newlineIdx).trim()
          stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1)

          if (!line) continue

          try {
            const parsed = JSON.parse(line)
            // Fix: Check for sessionId in camelCase from result
            if (parsed.result?.sessionId) {
               acpSessionId = parsed.result.sessionId
               process.stderr.write(`[ScodeBackend] ACP Session Ready: ${acpSessionId}\n`)
               flushPending()
            }

            // Unblock UI if we get a result for a prompt
            if (parsed.result?.stopReason) {
               process.stderr.write(`[ScodeBackend] Turn Ended. Unblocking UI...\n`)

               const rawUsage = parsed.result.usage || {}
               const usage = {
                  input_tokens: rawUsage.inputTokens || 0,
                  output_tokens: rawUsage.outputTokens || 0,
                  cache_read_input_tokens: rawUsage.cachedReadTokens || 0,
                  cache_creation_input_tokens: rawUsage.cachedWriteTokens || 0
               }
               const assistantUuid = randomUUID()

               // Final sync to transcript
               if (currentAssistantText) {
                  const assistantEvent = {
                    type: 'assistant',
                    sessionId: options.sessionId,
                    uuid: assistantUuid,
                    parentUuid: lastPersistedUuid,
                    isSidechain: false,
                    timestamp: new Date().toISOString(),
                    cwd: options.cwd,
                    userType: 'external',
                    version: 'unknown',
                    message: {
                      role: 'assistant',
                      content: [{ type: 'text', text: currentAssistantText }],
                      usage: usage,
                      model: model
                    }
                  }
                  void writeTranscript(assistantEvent)
                  lastPersistedUuid = assistantUuid
               }

               const resultEvent = JSON.stringify({
                  type: 'result',
                  session_id: options.sessionId,
                  status: 'success',
                  usage: usage
               })
               process.stderr.write(`[ScodeBackend] EMITTING RESULT EVENT: ${resultEvent}\n`)
               for (const l of stdoutListeners) l(resultEvent + '\n')

               // Reset for next turn
               currentAssistantText = ''
            }

            // Forward AI message chunks
            if (parsed.method === 'session/update' && parsed.params) {
               const { update } = parsed.params
               const sessionUpdate = parsed.params.sessionUpdate || update?.sessionUpdate

               // 1. Handle AI Text Output
               if (sessionUpdate === 'agent_message_chunk' && update) {
                  const content = update.content || update.message?.content
                  const text = content?.text || (Array.isArray(content) ? content[0]?.text : content?.text) || ''

                  if (text) {
                     currentAssistantText += text
                     const messagePayload = {
                        role: 'assistant',
                        content: [{ type: 'text', text: currentAssistantText }]
                     }
                     const mossEvent = JSON.stringify({
                        type: 'assistant',
                        session_id: options.sessionId,
                        message: messagePayload,
                        uuid: options.sessionId,
                        timestamp: new Date().toISOString()
                     })
                     process.stderr.write(`[ScodeBackend] EMITTING ASSISTANT EVENT (BLOCK ARRAY): ${mossEvent}\n`)
                     for (const l of stdoutListeners) {
                        l(mossEvent + '\n')
                        // HACK: Also emit a raw stdout line in case the UI is listening for that
                        l(currentAssistantText + '\n')
                     }
                  }
               }

               // 2. Handle Tool Calls (for "Thinking..." state)
               if (sessionUpdate === 'tool_call' && update) {
                  const toolUuid = randomUUID()
                  const toolEvent = {
                     type: 'tool_use',
                     sessionId: options.sessionId,
                     uuid: toolUuid,
                     parentUuid: lastPersistedUuid,
                     isSidechain: false,
                     name: update.title || update.rawInput?.path || 'tool',
                     tool_use_id: update.toolCallId,
                     input: JSON.stringify(update.rawInput || {}),
                     timestamp: new Date().toISOString(),
                     cwd: options.cwd,
                     userType: 'external',
                     version: 'unknown'
                  }
                  process.stderr.write(`[ScodeBackend] EMITTING TOOL_USE EVENT: ${JSON.stringify(toolEvent)}\n`)
                  for (const l of stdoutListeners) l(JSON.stringify(toolEvent) + '\n')
                  void writeTranscript(toolEvent)
                  lastPersistedUuid = toolUuid
               }
            }
          } catch (e) {
            // Log parse errors if needed
          }
       }
    })

    // 1. Step: Unblock UI Initial
    setTimeout(() => {
      process.stderr.write(`[ScodeBackend] Unblocking UI with fake hello...\n`)
      const hello = JSON.stringify({
        type: 'hello',
        session_id: options.sessionId,
        runtimeType: 'host',
        state: 'running'
      }) + '\n'
      for (const l of stdoutListeners) l(hello)

      // 2. Step: ACP Handshake (CAMEL CASE FIX)
      sendRpc('initialize', {
        protocolVersion: '1.0',
        clientInfo: { name: 'moss-bridge', version: '1.0' }
      }, 'm-init')

      // 3. Step: Force create session (CAMEL CASE + MCP SERVERS FIX)
      setTimeout(() => {
        sendRpc('session/new', {
          cwd: options.cwd,
          mcpServers: []
        }, 'm-session-new')
      }, 500)
    }, 200)

    if (child.stderr) {
      const stderrRl = createInterface({ input: child.stderr })
      stderrRl.on('line', line => {
        for (const l of stderrListeners) l(line + '\n')
        process.stderr.write(`[scode stderr] ${line}\n`)
      })
    }

    child.on('close', (code, signal) => {
      for (const l of exitListeners) l(code, signal)
    })

    return {
      workDir: options.cwd,
      runtime: {
        type: 'host',
        engine: 'scode',
        configDir: options.runtime?.configDir,
      },
      writeStdin(data: string) {
        if (child.stdin?.destroyed) return

        if (!acpSessionId) {
           process.stderr.write(`[ScodeBackend] Session not ready, buffering message...\n`)
           pendingStdin.push(data)
           return
        }

        // EXTRACT CLEAN TEXT FROM MOSS JSON WRAPPER
        let cleanText = data;
        let userUuid = randomUUID();
        try {
           const parsed = JSON.parse(data);
           if (parsed.type === 'user') {
              cleanText = parsed.message?.content || data;
              userUuid = parsed.uuid || userUuid;
           }
        } catch {
           cleanText = data;
        }

        const userEvent = {
          type: 'user',
          sessionId: options.sessionId,
          uuid: userUuid,
          parentUuid: lastPersistedUuid,
          isSidechain: false,
          timestamp: new Date().toISOString(),
          cwd: options.cwd,
          userType: 'external',
          version: 'unknown',
          message: {
            role: 'user',
            content: cleanText.trim()
          }
        }
        void writeTranscript(userEvent)
        lastPersistedUuid = userUuid

        // Translate Moss Stdin to ACP Prompt (CAMEL CASE FIX)
        sendRpc('session/prompt', {
          sessionId: acpSessionId,
          prompt: [{ type: 'text', text: cleanText.trim() }]
        })
      },
      onStdoutLine(l) { stdoutListeners.add(l); return () => stdoutListeners.delete(l) },
      onStderrLine(l) { stderrListeners.add(l); return () => stderrListeners.delete(l) },
      onExit(l) { exitListeners.add(l); return () => exitListeners.delete(l) },
      destroy(force = false) {
        if (child.killed) return
        child.kill(force ? 'SIGKILL' : 'SIGTERM')
      }
    }
  }
}
