import { describe, expect, it } from 'bun:test';
import { selectConnectorForNewChat } from '../src/renderer-react/lib/connector-selection';

describe('connector new-chat selection', () => {
  it('opens the home composer and selects only the requested connector', () => {
    const calls: string[] = [];

    const selected = selectConnectorForNewChat({
      connectorId: 'qcc-company',
      navigateToNewChat: () => {
        calls.push('navigate');
        return true;
      },
      setDraftConnectorIds: (connectorIds) => {
        calls.push(`select:${connectorIds.join(',')}`);
      },
    });

    expect(selected).toBe(true);
    expect(calls).toEqual(['navigate', 'select:qcc-company']);
  });

  it('does not change the draft when navigation is cancelled', () => {
    let changed = false;

    const selected = selectConnectorForNewChat({
      connectorId: 'qcc-company',
      navigateToNewChat: () => false,
      setDraftConnectorIds: () => {
        changed = true;
      },
    });

    expect(selected).toBe(false);
    expect(changed).toBe(false);
  });
});
