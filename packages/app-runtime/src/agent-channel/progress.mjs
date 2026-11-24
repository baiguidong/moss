export function createAgentTurnProgress(options, publish) {
  const tools = new Map()
  let thinking = false
  let sequence = 0
  let pending = 0
  let available = true
  let tail = Promise.resolve()

  function emit(data) {
    if (!available || pending >= 16) return
    const index = ++sequence
    pending++
    tail = tail.then(async () => {
      if (available) available = await publish(data, index)
    }).catch(() => { available = false }).finally(() => { pending-- })
  }

  function observeBlock(block) {
    if (options.thinking && !thinking && block?.type === 'thinking') {
      thinking = true
      emit({ kind: 'thinking' })
    }
    if (!options.tools || block?.type !== 'tool_use' || typeof block.id !== 'string'
      || typeof block.name !== 'string' || !/^[\w.:-]{1,128}$/.test(block.name) || tools.has(block.id)) return
    tools.set(block.id, block.name)
    emit({ kind: 'tool', phase: 'started', toolName: block.name })
  }

  function observe(message) {
    if (!available || !message || message.parent_tool_use_id || message.isSidechain) return
    if (message.type === 'stream_event' && message.event?.type === 'content_block_start') {
      observeBlock(message.event.content_block)
    } else if (message.type === 'assistant' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) observeBlock(block)
    } else if (options.tools && message.type === 'user' && Array.isArray(message.message?.content)) {
      for (const block of message.message.content) {
        if (block?.type !== 'tool_result') continue
        const toolName = tools.get(block.tool_use_id)
        if (!toolName) continue
        tools.delete(block.tool_use_id)
        emit({ kind: 'tool', phase: block.is_error ? 'failed' : 'completed', toolName })
      }
    }
  }

  return { observe, flush: () => tail }
}
