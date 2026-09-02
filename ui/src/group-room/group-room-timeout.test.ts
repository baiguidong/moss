import { describe, expect, test } from 'bun:test'

import { PausableDeadline } from './group-room-timeout.mjs'

describe('PausableDeadline', () => {
  test('does not count time spent waiting for a permission decision', async () => {
    let fired = false
    const deadline = new PausableDeadline(80, () => { fired = true })
    await Bun.sleep(25)
    deadline.pause()
    await Bun.sleep(100)
    expect(fired).toBe(false)
    deadline.resume()
    await Bun.sleep(75)
    expect(fired).toBe(true)
    deadline.clear()
  })
})
