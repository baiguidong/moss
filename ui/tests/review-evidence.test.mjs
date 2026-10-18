import { test, expect, afterEach } from 'bun:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { attachReviewEvidence } from '../src/app-testing/review-evidence.mjs';
import { validateTestToolUse, TEST_REVIEW_ALLOWED_TOOLS } from '../src/app-testing/browser.mjs';
const roots = [];
const png = Buffer.from('89504e470d0a1a0a', 'hex');
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-review-evidence-')); roots.push(root);
  const dir = path.join(root, 'evidence'); await fs.mkdir(dir);
  await fs.writeFile(path.join(dir, 'a.png'), png);
  return { root, dir };
}
test('first request pairs filenames with native images, preserving bytes and deduplicating', async () => {
  const { dir } = await fixture();
  const content = await attachReviewEvidence('inspect', ['a.png', 'a.png'], dir);
  expect(content).toEqual([{ type: 'text', text: 'inspect' }, { type: 'text', text: '截图：a.png' },
    { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') } }]);
});
test('missing, forged, escaped and oversized evidence cannot become a review', async () => {
  const { root, dir } = await fixture();
  await fs.writeFile(path.join(root, 'outside.png'), png);
  await fs.symlink(path.join(root, 'outside.png'), path.join(dir, 'link.png'));
  await fs.writeFile(path.join(dir, 'fake.png'), 'not an image');
  const large = await fs.open(path.join(dir, 'large.png'), 'w'); await large.truncate(8 * 1024 * 1024 + 1); await large.close();
  for (const files of [[], ['missing.png'], ['fake.png'], ['../outside.png'], ['link.png'], ['large.png']]) {
    await expect(attachReviewEvidence('inspect', files, dir)).rejects.toThrow();
  }
});
test('evidence reviewer cannot read files, reopen the browser or search for tools', () => {
  const record = { appTestRunId: 'test', appTestEvidenceReview: true };
  for (const name of ['Read', 'ToolSearch', 'mcp__moss_test_browser__browser_run_code_unsafe']) {
    expect(validateTestToolUse(record, true, name)?.behavior).toBe('deny');
  }
  expect(validateTestToolUse(record, true, TEST_REVIEW_ALLOWED_TOOLS[0])).toBeNull();
});
