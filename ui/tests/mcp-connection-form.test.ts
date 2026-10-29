import { expect, test } from 'bun:test';
import type { McpCatalog, McpConfig } from '../../packages/app-sdk/src/mcp/index.mjs';
import { createMcpConnectionForms, parseMcpConnectionForms } from '../src/shared/mcp-connection-form';

const catalog = (...configs: McpConfig[]): McpCatalog => ({ servers: configs.map((config, index) => ({
  name: `service${index}`, enabled: false, config, updatedAt: 1, credentialsMissing: false, check: null,
})) });
const local: McpConfig = { type: 'stdio', command: 'node', args: ['a path with spaces', '', '--stdio'],
  env: { EXISTING_SECRET: '', DATA_DIR: '' }, disabledTools: ['write'],
  roots: { directories: ['/tmp'], includeWorkspace: true, delivery: 'roots' },
  pathBindings: [{ kind: 'git-repository', argument: '--repository' }], python: { requirements: ['example==1.0'] } };
const remote: McpConfig = { type: 'http', url: 'https://example.com/mcp', headers: { Authorization: '' },
  oauth: { clientId: 'client', callbackPort: 4444 }, disabledTools: ['delete'] };

test('opening and saving unchanged local or remote forms preserves the cached catalog revision', () => {
  const current = catalog(local, remote, { type: 'stdio', command: 'node' });
  expect(parseMcpConnectionForms(createMcpConnectionForms(current), current)).toEqual([]);
});

test('environment edits preserve arguments, advanced options, masked secrets and existing policy', () => {
  const current = catalog(local), forms = createMcpConnectionForms(current);
  forms[0].env = [{ name: 'EXISTING_SECRET', value: '' }, { name: 'NEW_KEY', value: ' value with spaces ' }];
  forms[0].directories = '/tmp\n/another/path';
  forms[0].executables![0].value = '/custom/git';
  const saved = parseMcpConnectionForms(forms, current)[0];
  expect(saved.enabled).toBe(false);
  expect(saved.config).toEqual({ ...local, env: { EXISTING_SECRET: '', NEW_KEY: ' value with spaces ' },
    roots: { ...local.roots!, directories: ['/tmp', '/another/path'] },
    pathBindings: [{ kind: 'git-repository', argument: '--repository', executable: '/custom/git' }] });
});

test('HTTP edits preserve OAuth and hidden authorization values and support deleting headers', () => {
  const current = catalog(remote), forms = createMcpConnectionForms(current);
  forms[0].url = 'https://new.example.com/mcp';
  forms[0].headers.push({ name: 'X-Account', value: 'account' });
  expect(parseMcpConnectionForms(forms, current)[0].config).toEqual({ ...remote, url: forms[0].url, headers: { Authorization: '', 'X-Account': 'account' } });
  forms[0].headers = [];
  expect(parseMcpConnectionForms(forms, current)[0].config.headers).toEqual({});
});

test('invalid fields are rejected before saving any service', () => {
  const current = catalog(local, remote);
  for (const rows of [[{ name: '', value: 'secret' }], [{ name: 'TOKEN', value: 'one' }, { name: ' TOKEN ', value: 'two' }]]) {
    const forms = createMcpConnectionForms(current); forms[0].command = 'changed'; forms[1].headers = rows;
    expect(() => parseMcpConnectionForms(forms, current)).toThrow();
  }
  for (const advanced of ['{broken', '[]', '{"env":{"TOKEN":"hidden"}}', '{"disabledTools":[]}']) {
    const forms = createMcpConnectionForms(current); forms[0].advanced = advanced;
    expect(() => parseMcpConnectionForms(forms, current)).toThrow();
  }
  const forms = createMcpConnectionForms(current); forms[1].url = 'file:///private';
  expect(() => parseMcpConnectionForms(forms, current)).toThrow('HTTP');
});

test('changing transport drops incompatible fields while preserving exclusion policy', () => {
  const current = catalog(local, remote), forms = createMcpConnectionForms(current);
  forms[0].type = 'http'; forms[0].url = remote.url!;
  forms[1].type = 'stdio'; forms[1].command = 'node';
  const saved = parseMcpConnectionForms(forms, current);
  expect(saved[0].config).toEqual({ type: 'http', url: remote.url, disabledTools: ['write'] });
  expect(saved[1].config).toEqual({ type: 'stdio', command: 'node', disabledTools: ['delete'] });
});
