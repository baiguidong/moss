// 火山豆包端到端实时语音大模型 —— 连通性 / 鉴权测试
//
// 目的:验证现有火山凭证能否连上端到端实时语音大模型。
// 不发真实音频,只走 握手 → StartConnection → StartSession,
// 收到 ConnectionStarted + SessionStarted 即证明凭证可用、订阅已开通。
//
// 用法:
//   export VOLC_APP_ID=你的APPID
//   export VOLC_ACCESS_TOKEN=你的AccessToken
//   node voice-demo/test-volc-realtime.mjs
//
// 注意:APPID / AccessToken 来自火山控制台「语音技术」应用,
// 不是 IAM 的 AK/SK(AKLT... 开头那种在这里用不上)。

import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import {
  buildEventFrame,
  parseFrame,
  EVENT,
  isSuccessEvent,
  isFailureEvent,
} from './volc-protocol.mjs'

const WS_URL = 'wss://openspeech.bytedance.com/api/v3/realtime/dialogue'
const RESOURCE_ID = 'volc.speech.dialog'
const TIMEOUT_MS = 10_000

const APP_ID = process.env.VOLC_APP_ID
const ACCESS_TOKEN = process.env.VOLC_ACCESS_TOKEN

if (!APP_ID || !ACCESS_TOKEN) {
  console.error('❌ 缺少凭证。请先设置环境变量:')
  console.error('   export VOLC_APP_ID=你的APPID')
  console.error('   export VOLC_ACCESS_TOKEN=你的AccessToken')
  console.error('   (到火山控制台「语音技术」应用里获取,不是 AKLT 开头的 AK/SK)')
  process.exit(2)
}

const connectId = randomUUID()
const sessionId = randomUUID()

console.log('→ 连接:', WS_URL)
console.log('  X-Api-Resource-Id:', RESOURCE_ID)
console.log('  X-Api-Connect-Id :', connectId)
console.log('  X-Api-App-Key    :', APP_ID)
console.log('  X-Api-Access-Key : ****' + ACCESS_TOKEN.slice(-4))
console.log('')

const ws = new WebSocket(WS_URL, {
  headers: {
    'X-Api-App-Key': APP_ID,
    'X-Api-Access-Key': ACCESS_TOKEN,
    'X-Api-Resource-Id': RESOURCE_ID,
    'X-Api-Connect-Id': connectId,
  },
})

let done = false
function finish(code, msg) {
  if (done) return
  done = true
  if (msg) console.log('\n' + msg)
  clearTimeout(timer)
  try {
    ws.close()
  } catch {}
  // 给 close 一点时间再退出
  setTimeout(() => process.exit(code), 200)
}

const timer = setTimeout(() => {
  finish(1, '❌ 超时:' + TIMEOUT_MS / 1000 + 's 内未收到预期响应。可能是网络、地址或鉴权问题。')
}, TIMEOUT_MS)

// 握手成功时能拿到 101 响应头(含 X-Tt-Logid,便于工单排查)
ws.on('upgrade', res => {
  console.log('✓ 握手成功 (HTTP', res.statusCode + ')')
  const logid = res.headers['x-tt-logid']
  if (logid) console.log('  X-Tt-Logid:', logid)
})

// 握手被拒(如 401/403 鉴权失败)
ws.on('unexpected-response', (_req, res) => {
  let body = ''
  res.on('data', c => (body += c))
  res.on('end', () => {
    console.log('  logid:', res.headers['x-tt-logid'] || '(无)')
    if (body) console.log('  响应体:', body.slice(0, 500))
    finish(1, `❌ 握手被拒 (HTTP ${res.statusCode})。多半是鉴权失败或未开通该服务。`)
  })
})

ws.on('open', () => {
  console.log('→ 发送 StartConnection')
  ws.send(buildEventFrame(EVENT.StartConnection, {}))
})

ws.on('message', data => {
  const frame = parseFrame(data)
  const label = frame.eventName || frame.messageTypeName
  console.log('← 收到:', label, frame.payload ? JSON.stringify(frame.payload) : frame.rawTail ? `(tail ${frame.rawTail})` : '')

  if (frame.messageType === 0b1111) {
    finish(1, `❌ 服务端返回错误 (code=${frame.errorCode})。检查 APPID/Token 是否正确、是否开通端到端实时语音。`)
    return
  }

  if (frame.event === EVENT.ConnectionStarted) {
    console.log('→ 发送 StartSession (session_id=' + sessionId + ')')
    const payload = {
      tts: { audio_config: { channel: 1, format: 'pcm', sample_rate: 24000 } },
      dialog: { bot_name: '豆包' },
    }
    ws.send(buildEventFrame(EVENT.StartSession, payload, sessionId))
    return
  }

  if (frame.event === EVENT.SessionStarted) {
    finish(0, '✅ 凭证可用!已成功建立连接并开启会话(收到 SessionStarted)。')
    return
  }

  if (isFailureEvent(frame.event)) {
    finish(1, `❌ 失败事件:${frame.eventName}。检查订阅与凭证。`)
  }
})

ws.on('error', err => {
  finish(1, '❌ 连接错误:' + err.message)
})

ws.on('close', (code, reason) => {
  if (!done) {
    console.log('连接关闭:', code, reason?.toString() || '')
    finish(1)
  }
})
