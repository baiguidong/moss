// 火山豆包端到端实时语音大模型 —— 二进制协议编解码
//
// 帧结构:4 字节 header + 可选字段(event / session_id) + payload_size(4) + payload
//   byte0 = (protocol_version<<4)|header_size   → 0x11
//   byte1 = (message_type<<4)|flags             → 含 event 时 flags 带 0x04
//   byte2 = (serialization<<4)|compression      → JSON 无压缩 = 0x10
//   byte3 = 0x00 (reserved)
// 参考仓库现有 WS 客户端 src/services/voiceStreamSTT.ts 的 binary+JSON 混合协议模式。

const PROTOCOL_VERSION = 0b0001
const HEADER_SIZE = 0b0001 // 单位:4 字节,1 → header 共 4 字节

const MSG_TYPE = {
  CLIENT_FULL_REQUEST: 0b0001,
  CLIENT_AUDIO_ONLY: 0b0010,
  SERVER_FULL_RESPONSE: 0b1001,
  SERVER_ACK: 0b1011,
  SERVER_ERROR: 0b1111,
}

const MSG_TYPE_NAME = {
  0b0001: 'CLIENT_FULL_REQUEST',
  0b0010: 'CLIENT_AUDIO_ONLY',
  0b1001: 'SERVER_FULL_RESPONSE',
  0b1011: 'SERVER_ACK',
  0b1111: 'SERVER_ERROR',
}

const FLAG_WITH_EVENT = 0b0100
const FLAG_WITH_SEQUENCE = 0b0001

const SERIALIZATION_JSON = 0b0001
const COMPRESSION_NONE = 0b0000

// 事件码(端到端实时语音大模型)
export const EVENT = {
  StartConnection: 1,
  FinishConnection: 2,
  ConnectionStarted: 50,
  ConnectionFailed: 51,
  ConnectionFinished: 52,
  StartSession: 100,
  FinishSession: 102,
  SessionStarted: 150,
  SessionFinished: 152,
  SessionFailed: 153,
  TaskRequest: 200,
  SayHello: 300,
  TTSSentenceStart: 350,
  TTSSentenceEnd: 351,
  TTSResponse: 352,
  TTSEnded: 359,
  ASRInfo: 450,
  ASRResponse: 451,
  ASREnded: 459,
  ChatTTSText: 500,
  ChatResponse: 550,
  ChatEnded: 559,
}

const EVENT_NAME = Object.fromEntries(
  Object.entries(EVENT).map(([k, v]) => [v, k]),
)

// 构造 full-client-request 事件帧。
// sessionId 为 null 时不带 session 字段(用于 StartConnection)。
export function buildEventFrame(event, payloadObj, sessionId = null) {
  const payloadBytes = Buffer.from(JSON.stringify(payloadObj ?? {}), 'utf8')

  const header = Buffer.from([
    (PROTOCOL_VERSION << 4) | HEADER_SIZE,
    (MSG_TYPE.CLIENT_FULL_REQUEST << 4) | FLAG_WITH_EVENT,
    (SERIALIZATION_JSON << 4) | COMPRESSION_NONE,
    0x00,
  ])

  const eventBuf = Buffer.alloc(4)
  eventBuf.writeInt32BE(event, 0)

  const parts = [header, eventBuf]

  if (sessionId != null) {
    const sid = Buffer.from(sessionId, 'utf8')
    const sidLen = Buffer.alloc(4)
    sidLen.writeUInt32BE(sid.length, 0)
    parts.push(sidLen, sid)
  }

  const sizeBuf = Buffer.alloc(4)
  sizeBuf.writeUInt32BE(payloadBytes.length, 0)
  parts.push(sizeBuf, payloadBytes)

  return Buffer.concat(parts)
}

// 尽力从字节段中提取一段 JSON 文本(容忍 id/size 框架偏差,连通性测试足够)。
function extractJson(buf) {
  const start = buf.indexOf(0x7b) // '{'
  const end = buf.lastIndexOf(0x7d) // '}'
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(buf.slice(start, end + 1).toString('utf8'))
  } catch {
    return null
  }
}

// 解析服务端帧。为连通性测试服务:稳定给出 messageType / event,
// payload 用尽力解析(不做逐字节严格 id 解析,避免框架偏差导致崩溃)。
export function parseFrame(buffer) {
  const buf = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer)
  if (buf.length < 4) return { raw: buf.toString('hex') }

  const headerSize = buf[0] & 0x0f
  const messageType = buf[1] >> 4
  const flags = buf[1] & 0x0f

  const result = {
    messageType,
    messageTypeName: MSG_TYPE_NAME[messageType] ?? `0b${messageType.toString(2)}`,
    flags,
  }

  let offset = headerSize * 4
  if (flags & FLAG_WITH_SEQUENCE) {
    result.seq = buf.readInt32BE(offset)
    offset += 4
  }
  if (flags & FLAG_WITH_EVENT) {
    result.event = buf.readInt32BE(offset)
    result.eventName = EVENT_NAME[result.event] ?? `event=${result.event}`
    offset += 4
  }

  const rest = buf.slice(offset)

  if (messageType === MSG_TYPE.SERVER_ERROR) {
    result.errorCode = rest.length >= 4 ? rest.readUInt32BE(0) : undefined
  }

  const json = extractJson(rest)
  if (json !== null) result.payload = json
  else if (rest.length) result.rawTail = rest.slice(0, 64).toString('hex')

  return result
}

export function isSuccessEvent(event) {
  return event === EVENT.ConnectionStarted || event === EVENT.SessionStarted
}

export function isFailureEvent(event) {
  return (
    event === EVENT.ConnectionFailed ||
    event === EVENT.SessionFailed ||
    event === EVENT.ConnectionFinished
  )
}
