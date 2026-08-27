import { describe, expect, it } from 'bun:test';
import {
  createAdapterBridgeMessage,
  createAdapterBridgeResponse,
  parseAdapterBridgeRequest,
} from '../src/adapter-process-protocol.mjs';

describe('adapter process protocol', () => {
  it('creates and parses versioned requests', () => {
    const message = createAdapterBridgeMessage('conversation.list', { query: 'demo' }, {
      id: 'request-1',
      timestamp: 123,
    });
    expect(parseAdapterBridgeRequest(message)).toEqual(message);
    expect(createAdapterBridgeResponse(message, { ok: true })).toEqual({
      version: 1,
      replyTo: 'request-1',
      ok: true,
      result: { ok: true },
    });
  });

  it('rejects malformed or unsupported requests', () => {
    expect(parseAdapterBridgeRequest(null)).toBeNull();
    expect(parseAdapterBridgeRequest({ version: 2, id: 'x', type: 'test' })).toBeNull();
    expect(parseAdapterBridgeRequest({ version: 1, id: '', type: 'test' })).toBeNull();
  });
});
