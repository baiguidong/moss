import { describe, expect, test } from 'bun:test';
import { containsProjectConfirmationBypass } from '../src/shared/project-confirmation-policy.mjs';

describe('project connector confirmation policy', () => {
  test('detects confirmation bypass flags at any normal input nesting level', () => {
    expect(containsProjectConfirmationBypass({ skip_confirmation: true })).toBe(true);
    expect(containsProjectConfirmationBypass({ request: { options: { skipConfirmation: true } } })).toBe(true);
    expect(containsProjectConfirmationBypass([{ input: { skip_confirmation: true } }])).toBe(true);
  });

  test('does not reject normal confirmation-token retries', () => {
    expect(containsProjectConfirmationBypass({
      confirmation_token: 'one-time-token',
      skip_confirmation: false,
    })).toBe(false);
  });
});
