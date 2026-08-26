import { describe, expect, it } from 'bun:test';
import {
  acquireNativeOverlayVisibility,
  isNativeOverlayVisible,
} from '../src/renderer-react/lib/native-overlay-visibility';

describe('native overlay visibility', () => {
  it('stays active until every overlapping dialog releases it', () => {
    const releaseFirst = acquireNativeOverlayVisibility();
    const releaseSecond = acquireNativeOverlayVisibility();
    expect(isNativeOverlayVisible()).toBe(true);

    releaseFirst();
    expect(isNativeOverlayVisible()).toBe(true);

    releaseSecond();
    expect(isNativeOverlayVisible()).toBe(false);
  });
});
