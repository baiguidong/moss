import { afterEach, describe, expect, test } from 'bun:test'
import { formatModelAndBilling, formatWelcomeMessage, getLogoDisplayData } from '../logoV2Utils.js'

const ORIGINAL_DEMO_VERSION = process.env.DEMO_VERSION

afterEach(() => {
  if (ORIGINAL_DEMO_VERSION === undefined) {
    delete process.env.DEMO_VERSION
  } else {
    process.env.DEMO_VERSION = ORIGINAL_DEMO_VERSION
  }
})

describe('logo display data', () => {
  test('does not show API usage billing on startup logo', () => {
    process.env.DEMO_VERSION = 'test'

    expect(getLogoDisplayData().billingType).toBe('')
  })

  test('formats a model without a billing separator when billing is empty', () => {
    expect(formatModelAndBilling('custom-model', '', 80)).toEqual({
      shouldSplit: false,
      truncatedModel: 'custom-model',
      truncatedBilling: '',
    })
  })

  test('uses Chinese welcome messages', () => {
    expect(formatWelcomeMessage(null)).toBe('欢迎回来！')
    expect(formatWelcomeMessage('小明')).toBe('欢迎回来，小明！')
  })
})
