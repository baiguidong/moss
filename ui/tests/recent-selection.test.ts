import { describe, expect, it } from 'bun:test';
import { promoteRecentIds, rankRecentItems } from '../src/renderer-react/lib/recent-selection';

describe('recent selection ranking', () => {
  it('promotes new ids and removes duplicates', () => {
    expect(promoteRecentIds(['a', 'b', 'c'], ['c', 'd'])).toEqual(['c', 'd', 'a', 'b']);
  });

  it('keeps selected items visible before recent and fallback items', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({ id }));
    expect(rankRecentItems(items, (item) => item.id, ['f'], ['d', 'c'], 5).map((item) => item.id))
      .toEqual(['f', 'd', 'c', 'a', 'b']);
  });

  it('ignores stale ids and respects the quick selection limit', () => {
    const items = ['a', 'b', 'c'].map((id) => ({ id }));
    expect(rankRecentItems(items, (item) => item.id, [], ['missing', 'c'], 2).map((item) => item.id))
      .toEqual(['c', 'a']);
  });
});
