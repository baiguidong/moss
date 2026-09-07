import { describe, expect, it } from 'bun:test';
import {
  beginSessionBusyTiming,
  clearSessionBusyTiming,
  getSessionBusyStartedAt,
} from '../src/shared/session-busy-timing.mjs';

describe('session busy timing', () => {
  it('keeps the original start time while a session remains busy', () => {
    const session: { busyStartedAt?: number | null } = {};

    expect(beginSessionBusyTiming(session, 1_000)).toBe(1_000);
    expect(beginSessionBusyTiming(session, 5_000)).toBe(1_000);
    expect(getSessionBusyStartedAt(session, true)).toBe(1_000);
  });

  it('hides and clears the timer when work finishes', () => {
    const session = { busyStartedAt: 1_000 };

    expect(getSessionBusyStartedAt(session, false)).toBeNull();
    clearSessionBusyTiming(session);
    expect(session.busyStartedAt).toBeNull();
  });

  it('starts a fresh timer for the next turn', () => {
    const session = { busyStartedAt: 1_000 };
    clearSessionBusyTiming(session);

    expect(beginSessionBusyTiming(session, 8_000)).toBe(8_000);
  });
});
