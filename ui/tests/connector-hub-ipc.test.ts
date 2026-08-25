import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import {
  normalizeConnectorMcpConfig,
  normalizeMcpConfig,
  validateMcpServerConfig,
} from '../src/connector-hub-ipc.mjs';
import { McpAuthProvider } from '../../src/services/mcp/auth';

describe('connector MCP config normalization', () => {
  it('infers HTTP for remote servers that only provide a URL', () => {
    expect(normalizeMcpConfig({
      mcpServers: {
        'qq-mail': {
          timeout: 600,
          url: 'https://api.mail.qq.com/mcp',
        },
      },
    })).toEqual({
      mcpServers: {
        'qq-mail': {
          type: 'http',
          url: 'https://api.mail.qq.com/mcp',
        },
      },
    });
  });

  it('applies OAuth metadata from connector MCP overrides', () => {
    const normalized = normalizeConnectorMcpConfig('mail-example', {
      mcpServers: {
        mail: {
          url: 'https://api.mail.qq.com/mcp',
        },
      },
    }, {
      connectors: {
        'mail-example': {
          servers: {
            mail: {
              oauth: { clientName: 'WorkBuddy' },
            },
          },
        },
      },
    });
    const config = normalized.mcpServers.mail;

    expect(config).toEqual({
      type: 'http',
      url: 'https://api.mail.qq.com/mcp',
      oauth: { clientName: 'WorkBuddy' },
    });
    expect(new McpAuthProvider('mail', config).clientMetadata.client_name).toBe(
      'WorkBuddy',
    );
  });

  it('keeps the bundled QQ Mail WorkBuddy OAuth identity override', () => {
    const overrides = JSON.parse(readFileSync(
      new URL('../resources/connectors/connector-mcp-overrides.json', import.meta.url),
      'utf8',
    ));
    const normalized = normalizeConnectorMcpConfig('qq-mail', {
      mcpServers: {
        'qq-mail': {
          url: 'https://api.mail.qq.com/mcp',
        },
      },
    }, overrides);

    expect(normalized.mcpServers['qq-mail']?.oauth?.clientName).toBe('WorkBuddy');
  });

  it('keeps untyped command servers compatible with stdio', () => {
    expect(validateMcpServerConfig({
      command: 'npx',
      args: ['-y', 'example-mcp'],
    })).toEqual({
      type: 'stdio',
      command: 'npx',
      args: ['-y', 'example-mcp'],
    });
  });

  it('normalizes streamable HTTP transport aliases', () => {
    expect(validateMcpServerConfig({
      type: 'streamableHttp',
      url: 'https://example.com/mcp',
    })).toEqual({
      type: 'http',
      url: 'https://example.com/mcp',
    });
  });

  it('still rejects untyped configs without a command or URL', () => {
    expect(() => validateMcpServerConfig({})).toThrow(
      'stdio MCP server requires command.',
    );
  });
});
