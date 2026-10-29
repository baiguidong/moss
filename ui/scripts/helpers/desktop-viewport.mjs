import assert from 'node:assert/strict';

// Electron does not implement Browser.setWindowBounds. Use the isolated
// launcher's native window channel; page.setViewportSize would only emulate.
export async function resizeDesktopWindow(target, page, size) {
  const geometry = await target.resize(size);
  await page.waitForFunction(({ width, height }) => innerWidth === width && innerHeight === height,
    geometry.contentBounds);
  const { bounds, workArea } = geometry;
  assert.ok(bounds.x >= workArea.x && bounds.y >= workArea.y, 'Window starts inside display work area');
  assert.ok(bounds.x + bounds.width <= workArea.x + workArea.width + 1 &&
    bounds.y + bounds.height <= workArea.y + workArea.height + 1, 'Window fits above the system dock/taskbar');
  return geometry;
}

export async function assertComposerVisible(page, geometry) {
  const input = page.locator('textarea').filter({ visible: true }).first();
  const send = page.getByRole('button', { name: /^(发送|补充|排队|排队发送|加入队列)$/ }).filter({ visible: true }).last();
  await input.waitFor();
  await send.waitFor();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  assert.equal(viewport.width, geometry.contentBounds.width, 'Layout width matches native content');
  assert.equal(viewport.height, geometry.contentBounds.height, 'Layout height matches native content');
  const controls = {};
  for (const [name, locator] of [['input', input], ['send', send]]) {
    const rect = await locator.boundingBox();
    assert.ok(rect && rect.width > 0 && rect.height > 0, `${name} is visible`);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= viewport.width + 1 &&
      rect.y + rect.height <= viewport.height + 1, `${name} fits completely inside native content: ${JSON.stringify({ rect, viewport })}`);
    const exposed = await locator.evaluate(element => {
      const r = element.getBoundingClientRect();
      // Empty-input send buttons use pointer-events:none. Include the disabled
      // element in hit testing without changing its geometry or enabled state.
      const previous = element.style.pointerEvents;
      element.style.pointerEvents = 'auto';
      try { return [r.top + 2, r.bottom - 2].every(y => element.contains(document.elementFromPoint(r.left + r.width / 2, y))); }
      finally { element.style.pointerEvents = previous; }
    });
    assert.ok(exposed, `${name} is not clipped or covered`);
    controls[name] = rect;
  }
  return { ...geometry, viewport, controls };
}
