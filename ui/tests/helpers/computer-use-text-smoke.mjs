// Opt-in real Electron-app text test. Never sends a chat message or edits a draft.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app } from 'electron';
import { CuaDriverHost } from '../../src/computer-use/driver-host.mjs';
import { ComputerUseService, structured } from '../../src/computer-use/service.mjs';

async function main() {
  const root = process.env.MOSS_CUA_TEXT_SMOKE;
  assert.ok(root, 'Explicit output folder required');
  await fs.mkdir(root, { recursive: true });
  app.setPath('userData', path.join(root, 'electron-profile'));
  await app.whenReady();
  const bundleId = 'com.claude-code-haha.desktop';
  const host = new CuaDriverHost({ resourcesRoot: fileURLToPath(new URL('../../resources/computer-use', import.meta.url)), hostBundleId: 'com.github.Electron' });
  const service = new ComputerUseService({ host, expectedBundleId: 'com.github.Electron',
    getSettings: () => ({ enabled: true, apps: [{ bundleId, name: 'Claude Code Haha' }] }),
    saveSettings: () => { throw new Error('Test cannot persist grants'); },
    requestAccess: () => { throw new Error('Unexpected app or foreground request'); },
  });
  const session = { id: 'text-smoke', originChannel: 'desktop', sessionKind: 'chat' };
  let opened = false;
  let window_id;
  const invoke = async input => {
    const result = await service.invoke({ app: bundleId, ...input }, session);
    return { result, state: structured(result) };
  };
  const observe = () => invoke({ action: 'get_window_state', window_id, max_elements: 1500 });
  const saveImage = async (current, name) => {
    const image = current.result.content.find(c => c.type === 'image');
    assert.ok(image);
    await fs.writeFile(path.join(root, name), Buffer.from(image.data, 'base64'));
  };
  try {
    const status = await service.check();
    assert.ok(status.permissions?.hostIdentity && status.permissions.accessibility && status.permissions.screenRecording, status.error);
    await invoke({ action: 'launch_app' });
    const windows = (await invoke({ action: 'list_windows' })).state.windows;
    window_id = String(windows.find(w => w.window_id).window_id);
    let current = await observe();
    const drafts = current.state.elements.filter(e => e.role === 'AXTextArea').map(e => e.value || '');
    const button = current.state.elements.find(e => e.role === 'AXButton' && e.label === '搜索聊天');
    assert.ok(button, 'Search button not available; existing UI left unchanged');
    await invoke({ action: 'click', window_id, snapshot_id: current.state.snapshot_id, element_token: button.element_token });
    opened = true;
    current = await observe();
    const inputFor = state => {
      const fields = state.elements.filter(e => e.role === 'AXTextField');
      assert.equal(fields.length, 1, 'Search must be the only text field');
      return fields[0];
    };
    let field = inputFor(current.state);
    await saveImage(current, 'search-before.png');
    await fs.writeFile(path.join(root, 'search-field.json'), JSON.stringify(field, null, 2));
    // Cua exposes this Electron placeholder as AXValue when the field is empty.
    // Its empty state was also verified in search-before.png.
    const emptyValue = '搜索全部聊天内容…';
    assert.ok(!field.value || field.value === emptyValue, 'Search is not empty; refusing to overwrite it');
    const coords = element => { const f = element.screenshot_frame; assert.ok(f); return { x: f.x + f.w / 2, y: f.y + f.h / 2 }; };
    const text = 'Cua 测试 123';
    await invoke({ action: 'type_text', window_id, snapshot_id: current.state.snapshot_id, ...coords(field), text });
    current = await observe();
    field = inputFor(current.state);
    await saveImage(current, 'typed.png');
    assert.equal(field.value, text, 'Actual field value must equal the mixed Chinese text');
    console.log('CUA_TEXT_INPUT_PASSED: Cua 测试 123');
    // Background Cmd+A is not reliable in this target. Delete the known test
    // characters using the upstream pixel key route and observe after each key.
    for (let attempts = 0; attempts < text.length + 2; attempts++) {
      field = inputFor(current.state);
      if (!field.value || field.value === emptyValue) break;
      // AX can trim trailing whitespace. Follow the observed text prefix rather
      // than assuming one reported character disappears for each backspace.
      assert.ok(text.startsWith(field.value), 'Field changed outside the test text; stop cleanup');
      await invoke({ action: 'press_key', window_id, snapshot_id: current.state.snapshot_id, ...coords(field), key: 'backspace' });
      current = await observe();
    }
    assert.ok(!inputFor(current.state).value || inputFor(current.state).value === emptyValue);
    await saveImage(current, 'cleared.png');
    await invoke({ action: 'press_key', window_id, snapshot_id: current.state.snapshot_id, key: 'escape' });
    opened = false;
    current = await observe();
    assert.deepEqual(current.state.elements.filter(e => e.role === 'AXTextArea').map(e => e.value || ''), drafts);
    console.log('CUA_TEXT_CLEANUP_PASSED: search cleared and closed, chat draft preserved');
    await service.finish(session.id);
  } catch (error) {
    console.error(error); process.exitCode = 1;
    if (opened) {
      try { const current = await observe(); await invoke({ action: 'press_key', window_id, snapshot_id: current.state.snapshot_id, key: 'escape' }); }
      catch { console.error('Search cleanup requires inspection'); }
    }
  } finally { await host.stop(); app.exit(process.exitCode || 0); }
}
void main().catch(error => { console.error(error); app.exit(1); });
