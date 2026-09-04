import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import JSZip from 'jszip';
import {
  applyConnectorCliOverride,
  applyConnectorCredentials,
  buildConnectorCliEnv,
  cliStatusStatePatch,
  extractCliVersion,
  extractAuthorizationUrl,
  getConnectorProviderAuthContext,
  matchesCliStatus,
  normalizeConnectorCredentialProvision,
  normalizeConnectorCredentialSchema,
  normalizeConnectorMcpConfig,
  normalizeCliAuthSteps,
  normalizeMcpConfig,
  normalizeMcpServerName,
  requestProvisionedConnectorCredentials,
  runConnectorCommand,
  validateMcpServerConfig,
} from '../src/connector-hub-ipc.mjs';
import {
  fetchMcpAuthorizationChallenge,
  McpAuthProvider,
  rewriteOAuthMetadataOrigin,
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
  'lingyi-mcp',
  'qixinhuiyan-mcp',
  'salesnail-instructor',
  'salestouch',
  'tdx-connector',
  'teacher-assistant',
  'tencent-dlc',
  'tencent-qidian-cs',
  'tencent-survey',
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

    expect(catalogIds).toHaveLength(114);
    for (const id of REMOVED_CONNECTOR_IDS) {
      expect(catalogIds).not.toContain(id);
      expect(zipEntries.some((entry) => entry.startsWith(`connectors/${id}/`))).toBe(false);
      expect(zipEntries.some((entry) => entry.startsWith(`icons/${id}.`))).toBe(false);
    }
  });

  it('packages ShareOne as a skill-only connector with API key provisioning', async () => {
    const zip = await JSZip.loadAsync(readFileSync(
      new URL('../resources/connectors/workbuddy-connectors-config.zip', import.meta.url),
    ));
    const catalog = JSON.parse(await zip
      .file('.codebuddy-connector/connectors.json')!
      .async('text'));
    const connector = catalog.connectors.find((entry: { id: string }) => entry.id === 'shareone');
    const credentialSchema = JSON.parse(await zip
      .file('connectors/shareone/token-schema.json')!
      .async('text'));

    expect(connector).toMatchObject({
      id: 'shareone',
      source: 'shareone',
      type: 'skill-only',
      auth_mode: 'api-key',
    });
    expect(credentialSchema.provision).toMatchObject({
      url: 'https://shareone.vip/api/v1/agent-guest-key',
      targetField: 'SHAREONE_API_KEY',
      responseField: 'api_key',
    });
    expect(zip.file('connectors/shareone/skills/SKILL.md')).not.toBeNull();
    expect(zip.file('connectors/shareone/skills/scripts/publish.js')).not.toBeNull();
    expect(zip.file('icons/shareone.png')).not.toBeNull();
  });

  it('distinguishes the China and global Kling AI connectors', async () => {
    const zip = await JSZip.loadAsync(readFileSync(
      new URL('../resources/connectors/workbuddy-connectors-config.zip', import.meta.url),
    ));
    const catalog = JSON.parse(await zip
      .file('.codebuddy-connector/connectors.json')!
      .async('text'));

    expect(catalog.connectors.find((entry: { id: string }) => entry.id === 'kling-ai-plugin')?.name)
      .toBe('Kling AI（中国）');
    expect(catalog.connectors.find((entry: { id: string }) => entry.id === 'kling-ai-plugin-ai')?.name)
      .toBe('Kling AI（海外）');
  });

  it('distinguishes Canva regions and marks FBSir as authorization-free', async () => {
    const zip = await JSZip.loadAsync(readFileSync(
      new URL('../resources/connectors/workbuddy-connectors-config.zip', import.meta.url),
    ));
    const catalog = JSON.parse(await zip
      .file('.codebuddy-connector/connectors.json')!
      .async('text'));

    expect(catalog.connectors.find((entry: { id: string }) => entry.id === 'canva')?.name)
      .toBe('Canva可画（中国）');
    expect(catalog.connectors.find((entry: { id: string }) => entry.id === 'canva-ai')?.name)
      .toBe('Canva可画（海外）');
    expect(catalog.connectors.find((entry: { id: string }) => entry.id === 'fbs-connector')?.auth_mode)
      .toBe('none');
  });

  it('packages the WPS device login with its actual account host and Moss browser flow', async () => {
    const zip = await JSZip.loadAsync(readFileSync(
      new URL('../resources/connectors/workbuddy-connectors-config.zip', import.meta.url),
    ));
    const cli = JSON.parse(await zip
      .file('connectors/wps-knowledgebase/cli.json')!
      .async('text'));

    expect(cli).toMatchObject({
      authUrlDomain: 'account.wps.cn',
      authWaitForExit: false,
      authBrowserMode: 'moss',
    });
  });
});

describe('connector MCP config normalization', () => {
  it('reads provider-specific resource metadata from the MCP authorization challenge', async () => {
    let requestedUrl = '';
    let requestInit: RequestInit | undefined;
    const challenge = await fetchMcpAuthorizationChallenge({
      type: 'http',
      url: 'https://agent.qcc.com/mcp/company/stream',
    }, async (url, init) => {
      requestedUrl = String(url);
      requestInit = init;
      return new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer error="invalid_token", resource_metadata="https://agent.qcc.com/mcp/.well-known/oauth-protected-resource/company/stream"',
        },
      });
    });

    expect(requestedUrl).toBe('https://agent.qcc.com/mcp/company/stream');
    expect(requestInit?.method).toBe('POST');
    expect(new Headers(requestInit?.headers).get('Content-Type')).toBe('application/json');
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      jsonrpc: '2.0',
      method: 'initialize',
    });
    expect(challenge.status).toBe(401);
    expect(challenge.resourceMetadataUrl?.toString()).toBe(
      'https://agent.qcc.com/mcp/.well-known/oauth-protected-resource/company/stream',
    );
  });

  it('uses GET when probing an SSE server for an OAuth challenge', async () => {
    let requestInit: RequestInit | undefined;
    await fetchMcpAuthorizationChallenge({
      type: 'sse',
      url: 'https://example.test/sse',
    }, async (_url, init) => {
      requestInit = init;
      return new Response(null, { status: 401 });
    });

    expect(requestInit?.method).toBe('GET');
    expect(requestInit?.body).toBeUndefined();
  });

  it('retries an HTTP OAuth challenge with an older supported MCP protocol', async () => {
    const protocolVersions: string[] = [];
    const challenge = await fetchMcpAuthorizationChallenge({
      type: 'http',
      url: 'https://example.test/mcp',
    }, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      protocolVersions.push(body.params.protocolVersion);
      if (protocolVersions.length === 1) {
        return new Response('{"error":"unsupported protocol"}', { status: 400 });
      }
      return new Response(null, {
        status: 401,
        headers: {
          'WWW-Authenticate': 'Bearer resource_metadata="https://example.test/.well-known/oauth-protected-resource"',
        },
      });
    });

    expect(protocolVersions.length).toBe(2);
    expect(protocolVersions[0]).not.toBe(protocolVersions[1]);
    expect(challenge.status).toBe(401);
    expect(challenge.resourceMetadataUrl?.toString()).toBe(
      'https://example.test/.well-known/oauth-protected-resource',
    );
  });

  it('takes the provider browser strategy from connector auth configuration', () => {
    expect(getConnectorProviderAuthContext({
      authConfig: {
        authUrl: 'https://auth.example.test/authorize',
        browserMode: 'moss',
        tokenParam: 'access_token',
        allowedHosts: ['example.test'],
      },
    })).toEqual({
      browserMode: 'moss',
      tokenParam: 'access_token',
      allowedHosts: ['example.test'],
    });
    expect(getConnectorProviderAuthContext({
      authConfig: { authUrl: 'https://auth.example.test/authorize' },
    })?.browserMode).toBe('system');
  });

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
    const xingtu = normalizeConnectorMcpConfig('xingtu-claw-risk', {
      mcpServers: {
        'xingtu-claw-risk': { type: 'sse', url: 'https://claw-mcp.tcredit.com/mcp/sse' },
      },
    }, overrides);
    const finenter = normalizeConnectorMcpConfig('finenter', {
      mcpServers: {
        'mcp-server-brm': { type: 'sse', url: 'https://mcp-server-global.comein.cn/mcp-servers/mcp-server-brm/sse' },
      },
    }, overrides);
    const fyopen = normalizeConnectorMcpConfig('fyopen-lawsearch', {
      mcpServers: {
        'fy-law-search-service': { url: 'https://api.cjbdi.com:8443/354347/mcp_law_service' },
      },
    }, overrides);

    expect(mx.mcpServers['mx-ds-mcp']?.oauth?.clientName).toBe('WorkBuddy');
    expect(nges.mcpServers.nges?.oauth?.clientName).toBe('WorkBuddy');
    expect(pkulaw.mcpServers.pkulaw?.oauth?.omitRegistrationScope).toBe(true);
    expect(kling.mcpServers['kling-ai-plugin']?.oauth?.clientName).toBe('Plugin-WorkBuddy');
    expect(xingtu.mcpServers['xingtu-claw-risk']?.oauth?.redirectUri)
      .toBe('moss://moss/mcp/xingtu-claw-risk/oauth/callback');
    expect(finenter.mcpServers['mcp-server-brm']?.oauth?.resourceMetadataUrl)
      .toBe('https://server.comein.cn/.well-known/oauth-protected-resource/mcp-server-brm');
    expect(fyopen.mcpServers['fy-law-search-service']?.oauth).toMatchObject({
      authServerMetadataUrl: 'https://fyopen.com/.well-known/oauth-authorization-server/apis/cop-oauth2',
      authorizationServerOrigin: 'https://fyopen.com',
    });
  });

  it('rewrites OAuth endpoints that use a blocked alias origin', () => {
    expect(rewriteOAuthMetadataOrigin({
      issuer: 'https://www.fyopen.com/apis/cop-oauth2',
      authorization_endpoint: 'https://www.fyopen.com/apis/cop-oauth2/oauth2/authorize',
      token_endpoint: 'https://www.fyopen.com/apis/cop-oauth2/oauth2/token',
      registration_endpoint: 'https://www.fyopen.com/apis/cop-oauth2/oauth2/register',
      response_types_supported: ['code'],
    }, 'https://fyopen.com')).toMatchObject({
      issuer: 'https://fyopen.com/apis/cop-oauth2',
      authorization_endpoint: 'https://fyopen.com/apis/cop-oauth2/oauth2/authorize',
      token_endpoint: 'https://fyopen.com/apis/cop-oauth2/oauth2/token',
      registration_endpoint: 'https://fyopen.com/apis/cop-oauth2/oauth2/register',
    });
  });

  it('preserves packaged static MCP headers as request headers', () => {
    expect(validateMcpServerConfig({
      type: 'streamableHttp',
      url: 'https://api.example.test/mcp',
      staticHeaders: {
        'X-Connector-Source': 'catalog',
        'X-Request-Source': 'workbuddy',
      },
      headers: {
        'X-Request-Source': 'moss',
      },
      disabledTools: ['dangerous_tool', 'dangerous_tool'],
    })).toMatchObject({
      headers: {
        'X-Connector-Source': 'catalog',
        'X-Request-Source': 'moss',
      },
      disabledTools: ['dangerous_tool'],
    });
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
  it('applies WPS authorization compatibility without changing the installed cli.json', () => {
    const overrides = JSON.parse(readFileSync(
      new URL('../resources/connectors/connector-cli-overrides.json', import.meta.url),
      'utf8',
    ));
    const installed = {
      authUrlDomain: 'zhishi.wps.cn',
      authWaitForExit: true,
      auth: { darwin: 'kwiki-cli auth login' },
    };

    expect(applyConnectorCliOverride('wps-knowledgebase', installed, overrides)).toEqual({
      authUrlDomain: 'account.wps.cn',
      authWaitForExit: false,
      authBrowserMode: 'moss',
      auth: { darwin: 'kwiki-cli auth login' },
    });
    expect(installed).toEqual({
      authUrlDomain: 'zhishi.wps.cn',
      authWaitForExit: true,
      auth: { darwin: 'kwiki-cli auth login' },
    });
  });

  it('terminates a timed-out connector command together with inherited child processes', async () => {
    const tempDir = mkdtempSync(join(tmpdir(), 'moss-connector-timeout-'));
    const childPath = join(tempDir, 'child.cjs');
    const wrapperPath = join(tempDir, 'wrapper.cjs');
    writeFileSync(childPath, 'setInterval(() => {}, 1000);\n');
    writeFileSync(wrapperPath, [
      "const { spawnSync } = require('node:child_process');",
      `spawnSync(process.execPath, [${JSON.stringify(childPath)}], { stdio: 'inherit' });`,
      '',
    ].join('\n'));

    const startedAt = Date.now();
    try {
      const result = await runConnectorCommand(
        `${JSON.stringify(process.execPath)} ${JSON.stringify(wrapperPath)}`,
        { cwd: tempDir, timeoutMs: 50 },
      );
      expect(result.timedOut).toBe(true);
      expect(Date.now() - startedAt).toBeLessThan(3000);
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }, 5000);

  it('extracts a CLI version from structured JSON before generic semver coercion', () => {
    expect(extractCliVersion(JSON.stringify({
      code: 0,
      data: {
        apiVersion: 'v1',
        cliVersion: '0.1.13',
      },
    }))).toBe('0.1.13');
  });

  it('uses a connector version pattern before generic semver coercion', () => {
    expect(extractCliVersion(JSON.stringify({
      code: 0,
      data: { cliVersion: '0.1.13' },
    }), '\\"cliVersion\\"\\s*:\\s*\\"(\\d+\\.\\d+\\.\\d+)\\"')).toBe('0.1.13');
  });

  it('matches authorization URLs against the connector-configured domain', () => {
    const url = 'https://accounts.feishu.cn/oauth/v1/device/verify?user_code=example';
    expect(extractAuthorizationUrl(`Open this URL: ${url}`, 'accounts.feishu.cn')).toBe(url);
    expect(extractAuthorizationUrl(url, 'open.feishu.cn')).toBe('');
  });

  it('maps live CLI status back to connector state', () => {
    expect(cliStatusStatePatch(true)).toEqual({
      connected: true,
      setupStatus: 'connected',
      setupMessage: '连接器可用',
    });
    expect(cliStatusStatePatch(false)).toEqual({
      connected: false,
      setupStatus: 'needs-auth',
      setupMessage: 'CLI 未认证',
    });
  });

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
      authBrowserMode: 'moss',
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
        authBrowserMode: 'moss',
        command: { darwin: 'example config init' },
        skipIf: { darwin: 'example config show' },
      },
      {
        authUrlDomain: 'accounts.example.com',
        authWaitForExit: undefined,
        authSuppressBrowser: true,
        authQrModal: undefined,
        authBrowserMode: 'moss',
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

  it('normalizes HTTPS API key provisioning and blocks cross-origin validation', () => {
    expect(normalizeConnectorCredentialProvision({
      url: 'https://auth.example.test/guest-key',
      targetField: 'API_KEY',
      responseField: 'api_key',
      label: 'Create key',
      validation: {
        url: 'https://auth.example.test/me',
        headers: { 'X-API-Key': '${API_KEY}' },
      },
    }, ['API_KEY'])).toEqual({
      url: 'https://auth.example.test/guest-key',
      targetField: 'API_KEY',
      responseField: 'api_key',
      label: 'Create key',
      labelEn: '',
      validation: {
        url: 'https://auth.example.test/me',
        headers: { 'X-API-Key': '${API_KEY}' },
      },
    });

    expect(normalizeConnectorCredentialProvision({
      url: 'http://auth.example.test/guest-key',
      targetField: 'API_KEY',
      responseField: 'api_key',
    }, ['API_KEY'])).toBeNull();
    expect(normalizeConnectorCredentialProvision({
      url: 'https://auth.example.test/guest-key',
      targetField: 'API_KEY',
      responseField: 'api_key',
      validation: {
        url: 'https://other.example.test/me',
        headers: { Authorization: 'Bearer ${API_KEY}' },
      },
    }, ['API_KEY'])?.validation).toBeUndefined();
  });

  it('creates and validates a provisioned API key before it is saved', async () => {
    const calls: Array<{ url: string; method: string; apiKey: string | null }> = [];
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        method: String(init?.method || 'GET'),
        apiKey: new Headers(init?.headers).get('X-API-Key'),
      });
      if (url.endsWith('/guest-key')) {
        return new Response(JSON.stringify({ api_key: 'guest-secret' }), { status: 200 });
      }
      return new Response(JSON.stringify({ username: 'guest-user' }), { status: 200 });
    };
    const values = await requestProvisionedConnectorCredentials({
      title: 'Example',
      fields: [{ key: 'API_KEY', type: 'password' }],
      provision: {
        url: 'https://auth.example.test/guest-key',
        targetField: 'API_KEY',
        responseField: 'api_key',
        validation: {
          url: 'https://auth.example.test/me',
          headers: { 'X-API-Key': '${API_KEY}' },
        },
      },
    }, { fetchImpl });

    expect(values).toEqual({ API_KEY: 'guest-secret' });
    expect(calls).toEqual([
      { url: 'https://auth.example.test/guest-key', method: 'POST', apiKey: null },
      { url: 'https://auth.example.test/me', method: 'GET', apiKey: 'guest-secret' },
    ]);
  });
});
