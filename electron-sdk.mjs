/**
 * Claude Code Electron SDK
 *
 * 每个 ClaudeSession 是一个长驻子进程（cli-node.js），通过 stream-json
 * 协议持久通信。多轮对话在同一进程内完成，上下文完整保留。
 *
 * 用法（Electron 主进程 或 Node.js）：
 *
 *   import { ClaudeSession } from './electron-sdk.mjs'
 *
 *   const session = new ClaudeSession({
 *     apiKey: 'sk-ant-...',
 *     cwd: '/your/project',
 *   })
 *
 *   // 多轮对话
 *   for await (const msg of session.send('帮我重构这个函数')) {
 *     if (msg.type === 'assistant') {
 *       const text = msg.message.content.find(b => b.type === 'text')?.text
 *       process.stdout.write(text ?? '')
 *     }
 *     if (msg.type === 'result') console.log('\n[done]', msg.total_cost_usd, 'USD')
 *   }
 *
 *   // 第二轮（自动携带上下文）
 *   for await (const msg of session.send('解释一下你刚才做了什么')) { ... }
 *
 *   session.dispose()  // 销毁时终止子进程
 */

import { spawn } from 'child_process'
import { createInterface } from 'readline'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { randomUUID } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const DEFAULT_CLI = join(__dirname, 'cli-node.js')

export class ClaudeSession {
  #proc = null        // 子进程
  #rl = null          // readline 解析 stdout
  #sessionId = null   // 由 CLI 分配，首条 system/init 消息里取出
  #ready = false      // 进程已就绪（收到 system/init）
  #queue = []         // 并发保护：同一时刻只处理一条消息
  #processing = false
  #onLine = null      // 当前轮次的行回调
  #initPromise = null
  #permissionHandler = null

  /**
   * @param {object} opts
   * @param {string}  opts.apiKey   - Anthropic API key（也可通过环境变量 ANTHROPIC_API_KEY 传入）
   * @param {string}  [opts.cwd]    - 工作目录，默认 process.cwd()
   * @param {string}  [opts.model]  - 模型名，如 'claude-sonnet-4-6'
   * @param {string}  [opts.cliPath]- cli-node.js 的绝对路径
   * @param {boolean} [opts.bypassPermissions] - 跳过所有权限确认（默认 false）
   */
  constructor(opts = {}) {
    this.#permissionHandler = typeof opts.onPermissionRequest === 'function' ? opts.onPermissionRequest : null
    this.#initPromise = this.#start(opts)
  }

  async #start(opts) {
    const {
      apiKey = process.env.ANTHROPIC_API_KEY ?? '',
      cwd = process.cwd(),
      model,
      cliPath = DEFAULT_CLI,
      bypassPermissions = false,
    } = opts

    const args = [
      cliPath,
      '--print',
      '--output-format=stream-json',
      '--verbose',
      '--input-format=stream-json',
    ]
    if (model) args.push(`--model=${model}`)
    if (bypassPermissions) args.push('--dangerously-skip-permissions')

    this.#proc = spawn(process.execPath, args, {
      cwd,
      env: {
        ...process.env,
        ANTHROPIC_API_KEY: apiKey,
        ELECTRON_RUN_AS_NODE: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.#proc.stderr.on('data', () => {}) // 静默 stderr

    this.#rl = createInterface({ input: this.#proc.stdout, crlfDelay: Infinity })
    this.#rl.on('line', (line) => {
      if (!line.trim()) return
      let msg
      try { msg = JSON.parse(line) } catch { return }

      // 取出 session_id（每条消息都带）
      if (msg.session_id && !this.#sessionId) {
        this.#sessionId = msg.session_id
      }

      if (msg.type === 'control_request') {
        void this.#handleControlRequest(msg)
        return
      }

      if (this.#onLine) this.#onLine(msg)
    })

    // CLI 在收到第一条用户消息之前不输出任何内容，
    // 所以不等待 system/init，直接标记为就绪
    this.#ready = true

    await new Promise((resolve, reject) => {
      this.#proc.on('error', reject)
      // 给进程一点时间确认启动正常（100ms）
      setTimeout(resolve, 100)
    })
  }

  /**
   * 发送一条消息，返回 AsyncGenerator，按顺序 yield 每条 stream-json 事件。
   * 最后一条事件是 { type: 'result', ... }（包含 total_cost_usd、session_id 等）。
   * 支持并发调用——内部队列保证顺序执行。
   *
   * @param {string | Array} text  - 用户消息文本，或 Anthropic content block 数组
   * @param {object} [opts]
   * @param {AbortSignal} [opts.signal] - 可选，中断信号
   * @returns {AsyncGenerator<object>}
   */
  async *send(text, opts = {}) {
    await this.#initPromise

    // 串行队列：等前一条处理完
    await new Promise((resolve) => {
      this.#queue.push(resolve)
      if (!this.#processing) this.#flushQueue()
    })

    try {
      yield* this.#doSend(text, opts)
    } finally {
      this.#processing = false
      this.#flushQueue()
    }
  }

  #flushQueue() {
    if (this.#queue.length === 0) return
    this.#processing = true
    this.#queue.shift()()
  }

  #writeStdin(payload) {
    this.#proc?.stdin.write(JSON.stringify(payload) + '\n')
  }

  #sendControlError(requestId, error) {
    this.#writeStdin({
      type: 'control_response',
      response: {
        subtype: 'error',
        request_id: requestId,
        error: error instanceof Error ? error.message : String(error),
      },
    })
  }

  async #handleControlRequest(message) {
    const requestId = message?.request_id
    const request = message?.request
    if (!requestId || !request?.subtype) return

    if (request.subtype !== 'can_use_tool') {
      this.#sendControlError(requestId, `Unsupported control request subtype: ${request.subtype}`)
      return
    }

    let result
    try {
      if (this.#permissionHandler) {
        result = await this.#permissionHandler(request)
      }
    } catch (error) {
      this.#sendControlError(requestId, error)
      return
    }

    const behavior = result?.behavior === 'allow' ? 'allow' : 'deny'
    this.#writeStdin({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response:
          behavior === 'allow'
            ? {
                behavior: 'allow',
                ...(result?.updatedInput ? { updatedInput: result.updatedInput } : {}),
              }
            : {
                behavior: 'deny',
                message: result?.message || 'Rejected by desktop confirmation dialog.',
              },
      },
    })
  }

  async *#doSend(text, { signal } = {}) {
    const content = typeof text === 'string'
      ? [{ type: 'text', text }]
      : text

    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
    })

    // 消息队列 + promise 驱动的 yield
    const msgs = []
    let resolve = null
    let finished = false
    let error = null

    const prevOnLine = this.#onLine
    this.#onLine = (msg) => {
      msgs.push(msg)
      if (msg.type === 'result') finished = true
      const r = resolve; resolve = null; r?.()
    }

    // 处理 abort
    const onAbort = () => {
      error = new Error('Aborted')
      const r = resolve; resolve = null; r?.()
    }
    signal?.addEventListener('abort', onAbort)

    // 写入 stdin
    this.#proc.stdin.write(userMsg + '\n')

    try {
      while (true) {
        while (msgs.length > 0) {
          const msg = msgs.shift()
          yield msg
          if (msg.type === 'result') return
        }
        if (error) throw error
        if (finished) return
        await new Promise(r => { resolve = r })
      }
    } finally {
      signal?.removeEventListener('abort', onAbort)
      this.#onLine = prevOnLine
    }
  }

  /**
   * 中断当前正在执行的请求（发送 SIGINT 给子进程）
   */
  abort() {
    this.#proc?.kill('SIGINT')
  }

  /**
   * 销毁 Session，终止子进程，释放资源
   */
  dispose() {
    this.#rl?.close()
    this.#proc?.stdin.end()
    this.#proc?.kill()
    this.#proc = null
    this.#ready = false
  }

  /** CLI 分配的 session_id（可用于 --resume 恢复） */
  get sessionId() { return this.#sessionId }

  /** 是否就绪 */
  get ready() { return this.#ready }
}
