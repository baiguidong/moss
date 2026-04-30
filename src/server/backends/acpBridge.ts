import { createInterface } from 'readline'
import { appendFile, mkdir } from 'fs/promises'
import { dirname } from 'path'
import { randomUUID } from 'crypto'
import type { ChildProcess } from 'child_process'
import type { BackendHandle, SessionRuntimeInfo } from '../sessionManager.js'

type AcpBridgeOptions = {
  child: ChildProcess
  sessionId: string
  cwd: string
  model: string
  transcriptPath?: string
  runtime: SessionRuntimeInfo
}

export function createAcpBridgeHandle(options: AcpBridgeOptions): BackendHandle {
  const { child, sessionId, cwd, model, runtime } = options
  const transcriptPath = options.transcriptPath

  if (!child.stdin || !child.stdout) {
    throw new Error('Failed to start scode process pipes')
  }

  const stdoutListeners = new Set<(line: string) => void>()
  const stderrListeners = new Set<(line: string) => void>()
  const exitListeners = new Set<(code: number | null, signal: NodeJS.Signals | null) => void>()

  let rpcId = 1
  let acpSessionId: string | null = null
  const pendingStdin: string[] = []
  const pendingStdout: string[] = []
  let currentAssistantText = ''
  let lastPersistedUuid: string | null = null
  let isHandshakeComplete = false
  let currentTurnAssistantUuid: string | null = null

  const writeTranscript = async (event: any) => {
    if (!transcriptPath) return
    try {
      await mkdir(dirname(transcriptPath), { recursive: true })
      await appendFile(transcriptPath, JSON.stringify(event) + '\n', 'utf8')
    } catch (e: any) {
      process.stderr.write(`[AcpBridge] TRANSCRIPT WRITE ERROR: ${e.message}\n`)
    }
  }

  const sendRpc = (method: string, params: any, customId?: string) => {
    const id = customId || `m-${rpcId++}`
    const msg = { jsonrpc: '2.0', id, method, params }
    const raw = JSON.stringify(msg) + '\n'
    process.stderr.write(`[AcpBridge] Sending RPC: ${raw}`)
    child.stdin!.write(raw)
  }

  const emitStdout = (line: string) => {
    if (!isHandshakeComplete) {
      pendingStdout.push(line)
      return
    }
    for (const l of stdoutListeners) l(line)
  }

  const flushStdout = () => {
    while (pendingStdout.length > 0) {
      const line = pendingStdout.shift()!
      for (const l of stdoutListeners) l(line)
    }
  }

  const processUserMessage = (data: string) => {
    let cleanText = data
    let userUuid = randomUUID()
    try {
      const parsed = JSON.parse(data)
      if (parsed.type === 'user') {
        const content = parsed.message?.content || data
        if (Array.isArray(content)) {
          cleanText = content.map((c: any) => c.text || '').join('\n')
        } else {
          cleanText = typeof content === 'string' ? content : (content?.text || JSON.stringify(content))
        }
        userUuid = parsed.uuid || userUuid
      }
    } catch {
      cleanText = data
    }

    const trimmedText = typeof cleanText === 'string' ? cleanText.trim() : String(cleanText)

    const userEvent = {
      type: 'user',
      sessionId,
      uuid: userUuid,
      parentUuid: lastPersistedUuid,
      isSidechain: false,
      timestamp: new Date().toISOString(),
      cwd,
      userType: 'external',
      version: 'unknown',
      message: {
        role: 'user',
        content: trimmedText,
      },
    }
    void writeTranscript(userEvent)
    lastPersistedUuid = userUuid

    sendRpc('session/prompt', {
      sessionId: acpSessionId,
      prompt: [{ type: 'text', text: trimmedText }],
    })
  }

  const flushPending = () => {
    if (!acpSessionId || !isHandshakeComplete) {
      process.stderr.write(`[AcpBridge] flushPending skipped: sessionId=${!!acpSessionId}, ready=${isHandshakeComplete}\n`)
      return
    }

    if (pendingStdin.length === 0) return

    process.stderr.write(`[AcpBridge] Flushing ${pendingStdin.length} pending user messages...\n`)

    // Use setImmediate to ensure the engine has finished processing the session/new response
    setImmediate(() => {
      while (pendingStdin.length > 0) {
        const data = pendingStdin.shift()!
        try {
          process.stderr.write(`[AcpBridge] Flushing message: ${data.slice(0, 50)}...\n`)
          processUserMessage(data)
        } catch (e: any) {
          process.stderr.write(`[AcpBridge] Error flushing message: ${e.message}\n`)
        }
      }
    })
  }

  let stdoutBuffer = ''
  child.stdout.on('data', (data: Buffer) => {
    const chunk = data.toString('utf8')
    // Silencing the very verbose RAW STDOUT unless needed for deep debugging
    // process.stderr.write(`[AcpBridge] RAW STDOUT: ${chunk}\n`)
    stdoutBuffer += chunk

    while (true) {
      const newlineIdx = stdoutBuffer.indexOf('\n')
      if (newlineIdx === -1) break

      const line = stdoutBuffer.slice(0, newlineIdx).trim()
      stdoutBuffer = stdoutBuffer.slice(newlineIdx + 1)

      if (!line) continue

      try {
        const parsed = JSON.parse(line)

        if (parsed.id === 'm-init') {
          process.stderr.write(`[AcpBridge] Initialization complete, creating session...\n`)
          sendRpc('session/new', {
            cwd,
            mcpServers: [],
          }, 'm-session-new')
          continue
        }

        if (parsed.id === 'm-session-new') {
          acpSessionId = parsed.result?.sessionId
          process.stderr.write(`[AcpBridge] ACP Session Ready: ${acpSessionId}\n`)
          isHandshakeComplete = true
          process.stderr.write(`[AcpBridge] Handshake complete, flushing buffers (Stdout: ${pendingStdout.length}, Stdin: ${pendingStdin.length})\n`)
          flushStdout()
          flushPending()
          continue
        }

        // ... (rest of the stdout processing logic)

        if (parsed.result?.stopReason) {
          process.stderr.write(`[AcpBridge] Turn Ended. Unblocking UI...\n`)
          currentTurnAssistantUuid = null // Reset UUID for the next turn

          const rawUsage = parsed.result.usage || {}
          const usage = {
            input_tokens: rawUsage.inputTokens || 0,
            output_tokens: rawUsage.outputTokens || 0,
            cache_read_input_tokens: rawUsage.cachedReadTokens || 0,
            cache_creation_input_tokens: rawUsage.cachedWriteTokens || 0,
          }
          const assistantUuid = randomUUID()

          if (currentAssistantText) {
            const assistantEvent = {
              type: 'assistant',
              sessionId,
              uuid: assistantUuid,
              parentUuid: lastPersistedUuid,
              isSidechain: false,
              timestamp: new Date().toISOString(),
              cwd,
              userType: 'external',
              version: 'unknown',
              message: {
                role: 'assistant',
                content: [{ type: 'text', text: currentAssistantText }],
                usage,
                model,
              },
            }
            void writeTranscript(assistantEvent)
            lastPersistedUuid = assistantUuid
          }

          const resultEvent = JSON.stringify({
            type: 'result',
            session_id: sessionId,
            status: 'success',
            usage,
          })
          process.stderr.write(`[AcpBridge] EMITTING RESULT EVENT: ${resultEvent}\n`)
          emitStdout(resultEvent + '\n')

          currentAssistantText = ''
        }

        if (parsed.method === 'session/update' && parsed.params) {
          const { update } = parsed.params
          const sessionUpdate = parsed.params.sessionUpdate || update?.sessionUpdate

          if (sessionUpdate === 'agent_message_chunk' && update) {
            const content = update.content || update.message?.content
            let text = ''
            if (typeof content === 'string') {
              text = content
            } else if (content && typeof content === 'object') {
              text = content.text || (Array.isArray(content) ? content[0]?.text : content?.text) || ''
            }

            if (text) {
              process.stderr.write(`[AcpBridge] Received chunk: ${text.slice(0, 20)}...\n`)
              currentAssistantText += text

              if (!currentTurnAssistantUuid) {
                currentTurnAssistantUuid = randomUUID()
              }

              const messagePayload = {
                role: 'assistant',
                content: [{ type: 'text', text: currentAssistantText }],
              }
              const mossEvent = JSON.stringify({
                type: 'assistant',
                session_id: sessionId,
                message: messagePayload,
                uuid: currentTurnAssistantUuid,
                timestamp: new Date().toISOString(),
              })
              process.stderr.write(`[AcpBridge] EMITTING ASSISTANT EVENT: ${mossEvent}\n`)
              emitStdout(mossEvent + '\n')
              // Removed raw text emission to prevent duplicate display in UI
            }
          }

          if (sessionUpdate === 'tool_call' && update) {
            const toolUuid = randomUUID()
            const toolEvent = {
              type: 'tool_use',
              sessionId,
              uuid: toolUuid,
              parentUuid: lastPersistedUuid,
              isSidechain: false,
              name: update.title || update.rawInput?.path || 'tool',
              tool_use_id: update.toolCallId,
              input: JSON.stringify(update.rawInput || {}),
              timestamp: new Date().toISOString(),
              cwd,
              userType: 'external',
              version: 'unknown',
            }
            process.stderr.write(`[AcpBridge] EMITTING TOOL_USE EVENT: ${JSON.stringify(toolEvent)}\n`)
            emitStdout(JSON.stringify(toolEvent) + '\n')
            void writeTranscript(toolEvent)
            lastPersistedUuid = toolUuid
          }
        }
      } catch {
        // Ignore parse errors
      }
    }
  })

  // Initial hello and start handshake
  process.nextTick(() => {
    process.stderr.write(`[AcpBridge] Emitting initial hello and starting handshake...\n`)
    const hello = JSON.stringify({
      type: 'hello',
      session_id: sessionId,
      runtimeType: runtime.type,
      state: 'running',
    }) + '\n'
    // We don't use emitStdout here because we want hello to be first and we know
    // it will be buffered if listeners aren't ready yet, or sent immediately if they are.
    // However, during the very first tick, they might not be ready.
    // So we use the same buffering logic.
    emitStdout(hello)

    sendRpc('initialize', {
      protocolVersion: '1.0',
      clientInfo: { name: 'moss-bridge', version: '1.0' },
    }, 'm-init')
  })

  if (child.stderr) {
    const stderrRl = createInterface({ input: child.stderr })
    stderrRl.on('line', line => {
      for (const l of stderrListeners) l(line + '\n')
      process.stderr.write(`[AcpBridge stderr] ${line}\n`)
    })
  }

  child.on('close', (code, signal) => {
    for (const l of exitListeners) l(code, signal)
  })

  return {
    workDir: cwd,
    runtime,
    writeStdin(data: string) {
      if (child.stdin?.destroyed) return

      if (!acpSessionId) {
        process.stderr.write(`[AcpBridge] Session not ready, buffering message...\n`)
        pendingStdin.push(data)
        return
      }

      processUserMessage(data)
    },
    onStdoutLine(l) { stdoutListeners.add(l); return () => stdoutListeners.delete(l) },
    onStderrLine(l) { stderrListeners.add(l); return () => stderrListeners.delete(l) },
    onExit(l) { exitListeners.add(l); return () => exitListeners.delete(l) },
    destroy(force = false) {
      if (child.killed) return
      child.kill(force ? 'SIGKILL' : 'SIGTERM')
    },
  }
}