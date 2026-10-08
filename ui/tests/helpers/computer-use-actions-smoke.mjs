// Opt-in real desktop test; Calculator is the only authorized target.
// Run with Electron and MOSS_CUA_ACTION_SMOKE pointing to an empty temp folder.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { CuaDriverHost } from '../../src/computer-use/driver-host.mjs';
import { ComputerUseService, structured } from '../../src/computer-use/service.mjs';

async function main() {
const root = process.env.MOSS_CUA_ACTION_SMOKE;
assert.ok(root, 'Explicit test output folder required');
await fs.mkdir(root, { recursive: true });
app.setPath('userData', path.join(root, 'electron-profile'));
await app.whenReady();
const host = new CuaDriverHost({ resourcesRoot: fileURLToPath(new URL('../../resources/computer-use', import.meta.url)), hostBundleId: 'com.github.Electron' });
const service = new ComputerUseService({ host, expectedBundleId: 'com.github.Electron',
  getSettings: () => ({ enabled: true, apps: [{ bundleId: 'com.apple.calculator', name: 'Calculator' }] }),
  saveSettings: () => { throw new Error('Test cannot persist grants'); },
  requestAccess: () => { throw new Error('Unexpected app or foreground request'); },
});
const session = { id: 'calculator-test', originChannel: 'desktop', sessionKind: 'chat' };
const invoke = async input => {
  const result = await service.invoke({ app: 'com.apple.calculator', ...input }, session);
  return { result, state: structured(result) };
};
try {
  const status = await service.check();
  assert.deepEqual(status.permissions, { accessibility: true, screenRecording: true, hostIdentity: true, bundleId: 'com.github.Electron' }, status.error);
  await invoke({ action: 'launch_app' });
  const { state: windows } = await invoke({ action: 'list_windows' });
  const window_id = String(windows.windows.find(w => w.window_id).window_id);
  const observe = () => invoke({ action: 'get_window_state', window_id });
  let current = await observe();
  await fs.writeFile(path.join(root, 'initial-state.json'), JSON.stringify(current.state, null, 2));
  console.log(JSON.stringify(current.state.elements?.map(e => ({ label: e.label, role: e.role, value: e.value, token: e.element_token })), null, 2));
  if (process.env.MOSS_CUA_ACTION_OBSERVE_ONLY !== '1') {
    for (const label of ['全部清除', '1', '2', '8', '乘', '6', '4', '等于']) {
      const element = current.state.elements.find(e => e.role === 'AXButton' && e.label === label);
      assert.ok(element, `Missing Calculator button ${label}`);
      const clicked = await invoke({ action: 'click', window_id, snapshot_id: current.state.snapshot_id, element_token: element.element_token });
      console.log('CLICK', label, JSON.stringify(clicked.state));
      current = await observe();
    }
    await fs.writeFile(path.join(root, 'final-state.json'), JSON.stringify(current.state, null, 2));
    // Calculator on macOS 26 omits its display from AX. Save the real screenshot
    // for visual verification rather than declaring event delivery a success.
    console.log('CUA_ACTIONS_DELIVERED: inspect calculator.png for 128 × 64 = 8192');
  }
  const image = current.result.content.find(c => c.type === 'image');
  assert.ok(image);
  await fs.writeFile(path.join(root, 'calculator.png'), Buffer.from(image.data, 'base64'));
  await service.finish(session.id);
  assert.equal(service.owner, null);
} catch (error) { console.error(error); process.exitCode = 1; }
finally { await host.stop(); app.exit(process.exitCode || 0); }
}
void main().catch(error => { console.error(error); app.exit(1); });
