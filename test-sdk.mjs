import { ClaudeSession } from './electron-sdk.mjs'

const session = new ClaudeSession({
  apiKey: process.env.ANTHROPIC_API_KEY,
  cwd: process.cwd(),
})

console.log('Session created:', session.sessionId)
console.log('Sending message...\n')

for await (const msg of session.send('1+1=?')) {
  if (msg.type === 'assistant') {
    const text = msg.message.content.find(b => b.type === 'text')?.text
    if (text) console.log('[assistant]', text)
  } else if (msg.type === 'result') {
    console.log('[result] sessionId:', msg.session_id, 'cost:', msg.total_cost_usd, 'USD')
  }
}

// 第二轮对话（测试上下文是否保留）
console.log('\n--- 第二轮（测试持久化上下文）---\n')
for await (const msg of session.send('再加3等于几？')) {
  if (msg.type === 'assistant') {
    const text = msg.message.content.find(b => b.type === 'text')?.text
    if (text) console.log('[assistant]', text)
  } else if (msg.type === 'result') {
    console.log('[result] sessionId:', msg.session_id, 'cost:', msg.total_cost_usd, 'USD')
  }
}

session.dispose()
