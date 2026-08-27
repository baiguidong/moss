import { describe, expect, it } from 'bun:test';

import {
  mossCronMatches,
  parseMossCronExpression,
} from '../src/moss-cron-scheduler.mjs';

describe('Moss cron expressions', () => {
  it('supports ranges, lists, steps, and Sunday aliases', () => {
    const fields = parseMossCronExpression('*/15 9-10 * * 0,7');
    expect(fields).not.toBeNull();
    expect(mossCronMatches(fields!, new Date(2024, 0, 7, 9, 30))).toBe(true);
    expect(mossCronMatches(fields!, new Date(2024, 0, 7, 9, 31))).toBe(false);
    expect(parseMossCronExpression('60 * * * *')).toBeNull();
  });

  it('uses standard OR semantics when day-of-month and day-of-week are restricted', () => {
    const fields = parseMossCronExpression('0 12 1 * 1');
    expect(fields).not.toBeNull();
    expect(mossCronMatches(fields!, new Date(2024, 0, 8, 12, 0))).toBe(true);
    expect(mossCronMatches(fields!, new Date(2024, 1, 1, 12, 0))).toBe(true);
    expect(mossCronMatches(fields!, new Date(2024, 1, 2, 12, 0))).toBe(false);
  });
});
