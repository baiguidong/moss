import { describe, expect, it } from 'bun:test';

import {
  normalizeMcpStore,
  validateMcpServerConfig,
} from '../src/desktop-mcp-settings.mjs';

describe('desktop MCP settings', () => {
  it('normalizes stdio and streamable HTTP server configs', () => {
    expect(validateMcpServerConfig({
      command: ' node ',
      args: ['server.mjs'],
      env: { MODE: 'desktop' },
    })).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['server.mjs'],
      env: { MODE: 'desktop' },
    });

    expect(validateMcpServerConfig({
      type: 'streamable-http',
      url: ' https://mcp.example.com/api ',
      oauth: {
        redirectUri: 'moss://moss/mcp/example/oauth/callback',
        authorizationServerOrigin: 'https://auth.example.com',
        resourceMetadataUrl: 'https://auth.example.com/.well-known/oauth-protected-resource/api',
      },
      disabledTools: ['dangerous_tool'],
    })).toEqual({
      type: 'http',
      url: 'https://mcp.example.com/api',
      oauth: {
        redirectUri: 'moss://moss/mcp/example/oauth/callback',
        authorizationServerOrigin: 'https://auth.example.com',
        resourceMetadataUrl: 'https://auth.example.com/.well-known/oauth-protected-resource/api',
      },
      disabledTools: ['dangerous_tool'],
    });
  });

  it('drops malformed entries without discarding valid servers', () => {
    expect(normalizeMcpStore({
      servers: {
        valid_server: {
          enabled: true,
          config: { command: 'node' },
        },
        'invalid name': {
          enabled: true,
          config: { command: 'ignored' },
        },
        broken: {
          enabled: true,
          config: { type: 'http', url: 'file:///tmp/server' },
        },
      },
    }, 123)).toEqual({
      version: 1,
      servers: {
        valid_server: {
          enabled: true,
          config: { type: 'stdio', command: 'node', args: [] },
          updatedAt: 123,
        },
      },
    });
  });
});
