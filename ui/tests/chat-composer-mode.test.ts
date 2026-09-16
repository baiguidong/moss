import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/renderer-react/components/chat-area.tsx', import.meta.url), 'utf8');

describe('chat composer mode placement', () => {
  test('offers intent selection only in the new-session composer', () => {
    const activeComposer = source.slice(
      source.indexOf('{!isHomeComposer && ('),
      source.indexOf('{isHomeComposer && ('),
    );
    const newSessionComposer = source.slice(
      source.indexOf('{isHomeComposer && ('),
      source.indexOf('function HomeLanding'),
    );

    expect(activeComposer).not.toContain('模式：');
    expect(activeComposer).not.toContain('onComposerIntentChange(option.id)');
    expect(newSessionComposer).toContain('模式：');
    expect(newSessionComposer).toContain('onComposerIntentChange(option.id)');
  });
});
