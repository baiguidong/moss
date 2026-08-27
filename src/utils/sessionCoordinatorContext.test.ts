import { describe, expect, test } from 'bun:test'
import {
  getSessionCoordinatorMode,
  runWithCoordinatorModeGenerator,
} from './sessionCoordinatorContext.js'

async function collectModes(mode: boolean, gate: Promise<void>): Promise<Array<boolean | undefined>> {
  const values: Array<boolean | undefined> = []
  const iterator = runWithCoordinatorModeGenerator(mode, () => (async function* () {
    values.push(getSessionCoordinatorMode())
    await gate
    values.push(getSessionCoordinatorMode())
    yield getSessionCoordinatorMode()
  })())

  for await (const value of iterator) values.push(value)
  values.push(getSessionCoordinatorMode())
  return values
}

describe('session coordinator context', () => {
  test('isolates coordinator mode across concurrent async generators', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const coordinator = collectModes(true, gate)
    const regular = collectModes(false, gate)
    release()

    expect(await coordinator).toEqual([true, true, true, undefined])
    expect(await regular).toEqual([false, false, false, undefined])
  })
})
