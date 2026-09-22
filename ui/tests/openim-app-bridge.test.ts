import { describe, expect, it } from 'bun:test'
import {
  isOpenIMConversationOwnedBy,
  normalizeOpenIMReceivedMessages,
  normalizeOpenIMSessionEvent,
  openIMDirectConversationId,
} from '../src/openim/openim-app-bridge.mjs'

describe('OpenIM App bridge', () => {
  it('maps incoming direct text messages to stable Agent conversation identities', () => {
    expect(normalizeOpenIMReceivedMessages('OnRecvNewMessages', { data: [
      {
        sessionType: 1,
        contentType: 101,
        sendID: 'peer-1',
        recvID: 'self',
        serverMsgID: 'server-message-1',
        sendTime: 1_700_000_000,
        ex: 'moss.openim/automation-v1',
        textElem: { content: 'hello' },
      },
      {
        sessionType: 1,
        contentType: 114,
        sendID: 'peer-2',
        recvID: 'self',
        clientMsgID: 'client-message-2',
        createTime: 1_700_000_000_000,
        quoteElem: { text: 'quoted reply' },
      },
    ] }, { currentUserId: 'self' })).toEqual([
      {
        externalUserId: 'peer-1',
        externalConversationId: 'openim-user:self/direct:peer-1',
        externalEventId: 'server-message-1',
        text: 'hello',
        sentAt: 1_700_000_000_000,
        contentType: 101,
        sessionType: 1,
        extension: 'moss.openim/automation-v1',
      },
      {
        externalUserId: 'peer-2',
        externalConversationId: 'openim-user:self/direct:peer-2',
        externalEventId: 'client-message-2',
        text: 'quoted reply',
        sentAt: 1_700_000_000_000,
        contentType: 114,
        sessionType: 1,
      },
    ])
  })

  it('ignores self, group, unsupported, and incomplete messages', () => {
    const base = {
      sessionType: 1,
      contentType: 101,
      sendID: 'peer',
      recvID: 'self',
      serverMsgID: 'message',
      textElem: { content: 'hello' },
    }
    expect(normalizeOpenIMReceivedMessages('OtherEvent', base)).toEqual([])
    expect(normalizeOpenIMReceivedMessages('OnRecvNewMessage', { ...base, sendID: 'self' }, { currentUserId: 'self' })).toEqual([])
    expect(normalizeOpenIMReceivedMessages('OnRecvNewMessage', { ...base, recvID: 'other' }, { currentUserId: 'self' })).toEqual([])
    expect(normalizeOpenIMReceivedMessages('OnRecvNewMessage', base)).toEqual([])
    expect(normalizeOpenIMReceivedMessages('OnRecvNewMessage', { ...base, sessionType: 2 })).toEqual([])
    expect(normalizeOpenIMReceivedMessages('OnRecvNewMessage', { ...base, contentType: 102 })).toEqual([])
    expect(normalizeOpenIMReceivedMessages('OnRecvNewMessage', { ...base, serverMsgID: '', clientMsgID: '' })).toEqual([])
  })

  it('normalizes session lifecycle events', () => {
    expect(openIMDirectConversationId(' self ', ' peer ')).toBe('openim-user:self/direct:peer')
    expect(normalizeOpenIMSessionEvent('OnConnectSuccess', {}, 'self')).toEqual({ connected: true, userId: 'self' })
    expect(normalizeOpenIMSessionEvent('OnUserTokenExpired', {}, 'self')).toMatchObject({
      connected: false,
      userId: 'self',
      error: 'OpenIM session expired.',
    })
    expect(normalizeOpenIMSessionEvent('OnConversationChanged', {}, 'self')).toBeNull()
  })

  it('accepts only the active account default and direct conversation ids', () => {
    expect(isOpenIMConversationOwnedBy('openim-user:self/*', 'self', { allowDefault: true })).toBe(true)
    expect(isOpenIMConversationOwnedBy('openim-user:self/direct:peer-1', 'self', { peerUserId: 'peer-1' })).toBe(true)
    expect(isOpenIMConversationOwnedBy('openim-user:other/direct:peer-1', 'self')).toBe(false)
    expect(isOpenIMConversationOwnedBy('openim-user:self/direct:peer-2', 'self', { peerUserId: 'peer-1' })).toBe(false)
    expect(isOpenIMConversationOwnedBy('openim-user:self/*', 'self')).toBe(false)
    expect(isOpenIMConversationOwnedBy('not-an-openim-conversation', 'self', { allowDefault: true })).toBe(false)
  })
})
