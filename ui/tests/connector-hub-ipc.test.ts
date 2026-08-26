import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import JSZip from 'jszip';
import {
  applyConnectorCredentials,
  buildConnectorCliEnv,
  matchesCliStatus,
  normalizeConnectorCredentialSchema,
  normalizeConnectorMcpConfig,
  normalizeCliAuthSteps,
  normalizeMcpConfig,
  normalizeMcpServerName,
  validateMcpServerConfig,
} from '../src/connector-hub-ipc.mjs';
import {
  McpAuthProvider,
  withoutOAuthRegistrationScope,
} from '../../src/services/mcp/auth';

const REMOVED_CONNECTOR_IDS = [
  'archive-hospital-mcp',
  'chuhaijiang',
  'dzh-mcp',
  'fadada-richee',
  'fanruan-growth-advisor',
  'github',
  'gongyi-open-mcp',
  'ima-mcp',
  'jiandaoyun',
  'kdocs',
  'qixinhuiyan-mcp',
  'salesnail-instructor',
  'salestouch',
  'tdx-connector',
  'teacher-assistant',
  'tencent-dlc',
  'tencent-qidian-cs',
  'tencent-tchouse-c',
] as const;

describe('connector catalog pruning', () => {
  it('keeps provider-blocked connectors out of the active ZIP', async () => {
    const zip = await JSZip.loadAsync(readFileSync(
      new URL('../resources/connectors/workbuddy-connectors-config.zip', import.meta.url),
    ));
    const catalog = JSON.parse(await zip
      .file('.codebuddy-connector/connectors.json')!
      .async('text'));
    const catalogIds = catalog.connectors.map((connector: { id: string }) => connector.id);
    const zipEntries = Object.keys(zip.files);

    expect(catalogIds).toHaveLength(115);
    for (const id of REMOVED_CONNECTOR_IDS) {
      expect(catalogIds).not.toContain(id);
      expect(zipEntries.some((entry) => entry.startsWith(`connectors/${id}/`))).toBe(false);
      expect(zipEntries.some((entry) => entry.startsWith(`icons/${id}.`))).toBe(false);
    }
  });
});

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

  it('applies connector-specific OAuth registration fixes', () => {
    const overrides = JSON.parse(readFileSync(
      new URL('../resources/connectors/connector-mcp-overrides.json', import.meta.url),
      'utf8',
    ));
    const mx = normalizeConnectorMcpConfig('mx-ds-mcp', {
      mcpServers: {
        'mx-ds-mcp': { url: 'https://mxapi.eastmoney.com/mxds/v2/mcp' },
      },
    }, overrides);
    const nges = normalizeConnectorMcpConfig('tencent-health-nges', {
      mcpServers: {
        nges: { url: 'https://test.nges.qq.com/mcp/aggregate' },
      },
    }, overrides);
    const pkulaw = normalizeConnectorMcpConfig('pkulaw', {
      mcpServers: {
        pkulaw: { url: 'https://apim-gateway.pkulaw.com/mcp-law-agg/1.0.0/mcp' },
      },
    }, overrides);
    const kling = normalizeConnectorMcpConfig('kling-ai-plugin', {
      mcpServers: {
        'kling-ai-plugin': { url: 'https://klingai.com/mcp' },
      },
    }, overrides);

    expect(mx.mcpServers['mx-ds-mcp']?.oauth?.clientName).toBe('WorkBuddy');
    expect(nges.mcpServers.nges?.oauth?.clientName).toBe('WorkBuddy');
    expect(pkulaw.mcpServers.pkulaw?.oauth?.omitRegistrationScope).toBe(true);
    expect(kling.mcpServers['kling-ai-plugin']?.oauth?.clientName).toBe('Plugin-WorkBuddy');
  });

  it('omits scope only from connector client registration metadata', () => {
    expect(withoutOAuthRegistrationScope({
      client_name: 'Moss (pkulaw)',
      redirect_uris: ['http://127.0.0.1:49152/callback'],
      scope: 'openid wso2-role pkulaw-extensions',
    })).toEqual({
      client_name: 'Moss (pkulaw)',
      redirect_uris: ['http://127.0.0.1:49152/callback'],
    });
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

  it('normalizes provider server names instead of discarding them', () => {
    expect(normalizeMcpServerName('Canva可画', 'canva')).toBe('Canva');
    expect(normalizeMcpServerName('connector:camscanner-mcp')).toBe(
      'connector-camscanner-mcp',
    );
    expect(normalizeConnectorMcpConfig('chinese-server', {
      mcpServers: {
        '纯中文服务': { url: 'https://example.com/mcp' },
      },
    }, {})).toEqual({
      mcpServers: {
        'chinese-server': {
          type: 'http',
          url: 'https://example.com/mcp',
        },
      },
      serverNameAliases: {
        'chinese-server': '纯中文服务',
      },
    });
  });

  it('keeps normalized server names unique', () => {
    const normalized = normalizeMcpConfig({
      mcpServers: {
        'demo:server': { url: 'https://example.com/one' },
        'demo server': { url: 'https://example.com/two' },
      },
    });
    expect(Object.keys(normalized.mcpServers)).toEqual([
      'demo-server',
      'demo-server-2',
    ]);
  });
});

describe('connector CLI compatibility', () => {
  it('matches JSON status contracts without treating false values as connected', () => {
    const cli = {
      statusMatchJson: {
        logged_in: 'true',
        method: 'oauth',
      },
    };
    expect(matchesCliStatus(cli, '{"logged_in":false,"method":"oauth"}')).toBe(false);
    expect(matchesCliStatus(cli, '{"logged_in":true,"method":"oauth"}')).toBe(true);
  });

  it('evaluates regex status contracts', () => {
    expect(matchesCliStatus(
      { statusMatch: '"authenticated"\\s*:\\s*true' },
      '{ "authenticated" : true }',
    )).toBe(true);
    expect(matchesCliStatus({ statusMatch: '^READY\\s*$' }, 'READY\n')).toBe(true);
    expect(matchesCliStatus({ statusMatch: '\\bauthorized\\b' }, 'not authorized')).toBe(true);
  });

  it('maps WorkBuddy connector homes to the Moss install and extends PATH', () => {
    const env = buildConnectorCliEnv({
      env: {
        SL_CLI_HOME: '$HOME/.slclaw',
        SL_CONNECTOR_HOME: '$HOME/.workbuddy/connectors-marketplace/connectors/shanlong-claw',
      },
    }, '/tmp/moss/shanlong-claw', 'shanlong-claw', {
      HOME: '/tmp/home',
      PATH: '/usr/bin',
    });
    expect(env.SL_CLI_HOME).toBe('/tmp/home/.slclaw');
    expect(env.SL_CONNECTOR_HOME).toBe('/tmp/moss/shanlong-claw');
    expect(env.PATH?.split(':')).toContain('/tmp/home/.local/bin');
  });

  it('preserves ordered auth steps and inherits connector-level behavior', () => {
    expect(normalizeCliAuthSteps({
      authUrlDomain: 'accounts.example.com',
      authSuppressBrowser: true,
      auth: [
        {
          command: { darwin: 'example config init' },
          skipIf: { darwin: 'example config show' },
          authWaitForExit: true,
        },
        {
          command: { darwin: 'example auth login' },
        },
      ],
    })).toEqual([
      {
        authUrlDomain: 'accounts.example.com',
        authWaitForExit: true,
        authSuppressBrowser: true,
        authQrModal: undefined,
        command: { darwin: 'example config init' },
        skipIf: { darwin: 'example config show' },
      },
      {
        authUrlDomain: 'accounts.example.com',
        authWaitForExit: undefined,
        authSuppressBrowser: true,
        authQrModal: undefined,
        command: { darwin: 'example auth login' },
      },
    ]);
  });
});

describe('connector credential schemas', () => {
  it('normalizes supported fields without exposing password defaults', () => {
    expect(normalizeConnectorCredentialSchema({
      title: 'Example',
      fields: [
        { key: 'API_HOST', label: 'Host', type: 'text', defaultValue: 'api.example.com' },
        { key: 'API_TOKEN', label: 'Token', type: 'password', defaultValue: 'bundled-secret' },
        { key: 'invalid-key', type: 'text' },
      ],
    })).toEqual({
      title: 'Example',
      titleEn: '',
      description: '',
      descriptionEn: '',
      docUrl: '',
      docLabel: '',
      docLabelEn: '',
      fields: [
        {
          key: 'API_HOST',
          label: 'Host',
          labelEn: '',
          placeholder: '',
          placeholderEn: '',
          description: '',
          descriptionEn: '',
          type: 'text',
          required: true,
          defaultValue: 'api.example.com',
        },
        {
          key: 'API_TOKEN',
          label: 'Token',
          labelEn: '',
          placeholder: '',
          placeholderEn: '',
          description: '',
          descriptionEn: '',
          type: 'password',
          required: true,
        },
      ],
    });
  });

  it('injects credentials into HTTP headers, URLs, args, and stdio env', () => {
    expect(applyConnectorCredentials({
      type: 'http',
      url: 'https://example.com/mcp?key=${API_KEY}',
      headers: { Authorization: 'Bearer ${API_KEY}' },
    }, { API_KEY: 'secret' })).toEqual({
      type: 'http',
      url: 'https://example.com/mcp?key=secret',
      headers: { Authorization: 'Bearer secret' },
    });
    expect(applyConnectorCredentials({
      type: 'stdio',
      command: 'node',
      args: ['server.js', '--token=$API_KEY'],
      env: { EXISTING: 'value' },
    }, { API_KEY: 'secret' })).toEqual({
      type: 'stdio',
      command: 'node',
      args: ['server.js', '--token=secret'],
      env: { EXISTING: 'value', API_KEY: 'secret' },
    });
  });
});
