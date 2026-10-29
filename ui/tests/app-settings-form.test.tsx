import { test, expect } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { validateAppManifest } from '../../packages/app-sdk/src/index.mjs';
import { registerAppRuntimeIpc } from '../src/apps/app-runtime-ipc.mjs';
import { settingsFormFields } from '../src/renderer-react/components/app-settings-form';

const form = { id: 'connection', title: '连接设置', group: 'tools', permission: 'mcp:manage', form: { readAction: 'settings.read', saveAction: 'settings.save' } };
const manifest: any = { schemaVersion: 2, id: 'example.settings', version: '1.0.0', displayName: 'Example', hostApi: '^3.21.0',
  navigation: { location: 'none' }, permissions: ['mcp:manage'], contributes: { settings: [form] },
  backend: { entry: 'main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand', actions: [
    { name: 'settings.read' }, { name: 'settings.save', inputSchema: 'connection.json' },
  ] } };
const schema = { type: 'object', properties: { mode: { type: 'string', enum: ['local', 'remote'] } }, allOf: [
  { if: { properties: { mode: { const: 'remote' } } }, then: { properties: { token: { type: 'string', writeOnly: true } }, required: ['token'] } },
] };

test('Core settings forms require declared actions and coexist with legacy view routing', () => {
  expect(validateAppManifest(manifest).contributes?.settings[0].form).toEqual(form.form);
  expect(() => validateAppManifest({ ...manifest, contributes: { settings: [{ ...form, viewId: 'old' }] } })).toThrow();
  expect(() => validateAppManifest({ ...manifest, backend: { ...manifest.backend, actions: [] } })).toThrow();
  expect(() => validateAppManifest({ ...manifest, hostApi: '^3.20.0' })).toThrow();
  expect(settingsFormFields(schema, { mode: 'local' }).properties).not.toHaveProperty('token');
  expect(settingsFormFields(schema, { mode: 'remote' }).required).toContain('token');
});

test('settings IPC binds actions to the current package, checks grants and masks declared secrets', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-settings-form-'));
  try {
    await fs.writeFile(path.join(root, 'connection.json'), JSON.stringify(schema));
    const calls: string[] = [], handlers = new Map<string, Function>();
    const installation = { enabled: true, activeVersion: '1.0.0', grants: ['mcp:manage'] };
    const host = { getActivePackage: async () => ({ root, manifest }), getInstallation: () => installation,
      ensureDefaultInstance: async () => ({ id: 'default' }), invoke: async (_app: string, _instance: string, action: string, _input: unknown, options: any) => {
        options.authorizeDispatch(); calls.push(action);
        return { values: { mode: 'remote', token: 'must-never-reach-renderer' }, configuredFields: ['token'] };
      } };
    registerAppRuntimeIpc({ ipcMain: { handle: (name: string, handler: Function) => handlers.set(name, handler) }, getRuntime: () => host });
    const invoke = (patch = {}) => handlers.get('app:settings-form')!({}, { appId: manifest.id, version: manifest.version, settingId: 'connection', operation: 'read', ...patch });
    expect((await invoke()).values).toEqual({ mode: 'remote' });
    expect(calls).toEqual(['settings.read']);
    await invoke({ operation: 'save', values: { mode: 'local' } });
    expect(calls).toEqual(['settings.read', 'settings.save', 'settings.read']);
    await expect(invoke({ settingId: 'arbitrary-action' })).rejects.toThrow();
    await expect(invoke({ version: 'old' })).rejects.toThrow();
    installation.grants = [];
    await expect(invoke()).rejects.toThrow();
    expect(calls).toHaveLength(3);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
