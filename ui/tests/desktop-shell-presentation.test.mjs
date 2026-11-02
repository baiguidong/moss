import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDesktopShellPresentation } from '../src/client/desktop-shell-presentation.mjs';

test('Desktop appearance stays local while execution settings keep targeting the cloud Host', async () => {
  let appearance = { themeMode: 'light' }, host = { appearance: { themeMode: 'dark' }, model: 'cloud-model', settingsRevision: 3 };
  const updates = [], stored = new Map();
  let push, hostListener;
  const client = {
    getSettings: async () => host,
    updateSettings: async input => { updates.push(input); return host = { ...host, ...input }; },
    onSettingsChanged: callback => { hostListener = callback; return () => { hostListener = null; }; },
  };
  const shell = {
    getPresentation: async () => ({ appearance, panelLayout: '{"leftWidth":250}' }),
    updateAppearance: async input => appearance = input,
    onPresentation: callback => { push = callback; return () => {}; },
  };
  await attachDesktopShellPresentation(client, shell, { storage: { setItem: (key, value) => stored.set(key, value) }, changed: () => {} });
  assert.equal((await client.getSettings()).appearance.themeMode, 'light');
  assert.equal(stored.get('ui.panelLayout.v1'), '{"leftWidth":250}');
  await client.updateSettings({ appearance: { themeMode: 'system' }, model: 'new-cloud-model' });
  assert.deepEqual(updates, [{ model: 'new-cloud-model' }]);
  assert.equal(host.appearance.themeMode, 'dark');
  assert.equal(appearance.themeMode, 'system');
  const received = [];
  const stop = client.onSettingsChanged(value => received.push(value));
  hostListener({ ...host, model: 'newer-cloud-model' });
  assert.equal(received.at(-1).appearance.themeMode, 'system');
  push({ appearance: { themeMode: 'light' } });
  assert.equal(received.at(-1).model, 'newer-cloud-model');
  assert.equal(received.at(-1).appearance.themeMode, 'light');
  stop(); assert.equal(hostListener, null);
});
