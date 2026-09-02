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

  test('bounds large public context while retaining the newest messages', () => {
    const room = {
      id: 'room', topic: 'Topic', summary: '', summaryThroughSeq: 0,
      members: [{ id: 'a', displayName: 'A', role: 'Reviewer' }],
    }
    const messages = [1, 2, 3, 4, 5].map(seq => ({
      seq, status: 'completed', visibility: 'public', authorType: 'human', authorId: 'user', kind: 'message', content: `${seq}:${'x'.repeat(50_000)}`,
    }))
    const prompt = JSON.parse(buildRoomTurnPrompt({
      room,
      member: room.members[0],
      turn: { assignment: 'Review' },
      messages,
      snapshotSeq: 5,
    }))

    expect(prompt.publicMessages.at(-1).seq).toBe(5)
    expect(prompt.publicMessages.some((message: { seq: number }) => message.seq === 1)).toBe(false)
    expect(prompt.publicMessages.reduce((total: number, message: { content: string }) => total + message.content.length, 0)).toBeLessThanOrEqual(120_000)
  })
})
