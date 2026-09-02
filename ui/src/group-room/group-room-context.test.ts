import { describe, expect, test } from 'bun:test'

import { buildRoomTurnPrompt } from './group-room-context.mjs'

describe('Group Room context builder', () => {
  test('uses summary watermark and member delivery watermark without deleting source messages', () => {
    const room = {
      id: 'room', topic: 'Topic', summary: 'Earlier summary', summaryThroughSeq: 2,
      members: [{ id: 'a', displayName: 'A', role: 'Reviewer' }],
    }
    const member = { id: 'a', displayName: 'A', role: 'Reviewer' }
    const turn = { assignment: 'Review' }
    const messages = [1, 2, 3, 4].map(seq => ({
      seq, status: 'completed', visibility: 'public', authorType: 'human', authorId: 'host', kind: 'message', content: `M${seq}`,
    }))

    const full = JSON.parse(buildRoomTurnPrompt({ room, member, turn, messages, snapshotSeq: 4 }))
    const delta = JSON.parse(buildRoomTurnPrompt({ room, member, turn, messages, snapshotSeq: 4, afterSeq: 3 }))
    expect(full.publicMessages.map((message: { seq: number }) => message.seq)).toEqual([3, 4])
    expect(delta.publicMessages.map((message: { seq: number }) => message.seq)).toEqual([4])
  })
})
