import {
  openIMDefaultConversationId,
  openIMDirectConversationId as createScopedOpenIMConversationId,
  parseOpenIMDirectConversationId,
} from '../../../packages/app-sdk/src/openim/identifiers.mjs'

const OPENIM_RECEIVE_EVENTS = new Set(['OnRecvNewMessage', 'OnRecvNewMessages'])
const OPENIM_SESSION_EVENTS = new Set([
  'OnConnecting',
  'OnConnectSuccess',
  'OnConnectFailed',
  'OnKickedOffline',
  'OnUserTokenExpired',
  'OnUserTokenInvalid',
])
const OPENIM_TEXT_CONTENT_TYPES = new Set([101, 106, 114])
const OPENIM_SINGLE_SESSION = 1

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function eventPayload(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.hasOwn(value, 'data')
    ? value.data
    : value
}

function items(value) {
  const payload = eventPayload(value)
  return (Array.isArray(payload) ? payload : [payload]).filter(
    (entry) => entry && typeof entry === 'object' && !Array.isArray(entry),
  )
}

function messageText(message) {
  const contentType = Number(message.contentType)
  if (!OPENIM_TEXT_CONTENT_TYPES.has(contentType)) return ''
  if (contentType === 101) return text(message.textElem?.content)
  if (contentType === 106) return text(message.atTextElem?.text)
  return text(message.quoteElem?.text)
}

function timestamp(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) return Date.now()
  return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed
}

export function openIMDirectConversationId(currentUserId, peerUserId) {
  return createScopedOpenIMConversationId(currentUserId, peerUserId)
}

export function isOpenIMConversationOwnedBy(
  value,
  currentUserId,
  { allowDefault = false, peerUserId = '' } = {},
) {
  const owner = text(currentUserId)
  if (!owner) return false
  try {
    if (allowDefault && value === openIMDefaultConversationId(owner)) return true
    const conversation = parseOpenIMDirectConversationId(value)
    return Boolean(
      conversation
      && conversation.userId === owner
      && (!text(peerUserId) || conversation.peerUserId === text(peerUserId)),
    )
  } catch {
    return false
  }
}

export function normalizeOpenIMReceivedMessages(eventName, value, { currentUserId = '' } = {}) {
  if (!OPENIM_RECEIVE_EVENTS.has(eventName)) return []
  const ownerUserId = text(currentUserId)
  if (!ownerUserId) return []
  return items(value).flatMap((message) => {
    const externalUserId = text(message.sendID)
    const recipientUserId = text(message.recvID)
    const externalEventId = text(message.serverMsgID) || text(message.clientMsgID)
    const body = messageText(message)
    if (
      Number(message.sessionType) !== OPENIM_SINGLE_SESSION
      || !externalUserId
      || externalUserId === ownerUserId
      || recipientUserId !== ownerUserId
      || !externalEventId
      || !body
    ) return []
    return [{
      externalUserId,
      externalConversationId: openIMDirectConversationId(ownerUserId, externalUserId),
      externalEventId,
      text: body.slice(0, 100_000),
      sentAt: timestamp(message.sendTime || message.createTime),
      contentType: Number(message.contentType),
      sessionType: Number(message.sessionType),
      ...(text(message.ex) ? { extension: text(message.ex).slice(0, 1_024) } : {}),
    }]
  })
}

export function normalizeOpenIMSessionEvent(eventName, value, currentUserId = '') {
  if (!OPENIM_SESSION_EVENTS.has(eventName)) return null
  const payload = eventPayload(value)
  if (eventName === 'OnConnectSuccess') {
    return { connected: true, userId: text(currentUserId) }
  }
  if (eventName === 'OnConnecting') return { connected: false, userId: text(currentUserId) }
  const error = text(payload?.errMsg || payload?.message)
    || (eventName === 'OnKickedOffline'
      ? 'OpenIM account was signed in elsewhere.'
      : eventName.includes('Token')
        ? 'OpenIM session expired.'
        : 'OpenIM connection failed.')
  return { connected: false, userId: text(currentUserId), error }
}
