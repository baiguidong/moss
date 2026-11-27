import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpdateContent } from '../src/renderer-react/components/update-modal';
import type { UpdateState } from '../src/renderer-react/types';

const actions = { check() {}, download() {}, cancel() {}, install() {}, open() {}, reveal() {}, release() {}, skip() {} };
const state: UpdateState = { revision: 1, currentVersion: '1.0.0', version: '1.2.0', phase: 'downloaded', capabilities: { mode: 'manual', platform: 'darwin', arch: 'arm64', packageType: 'dmg' }, downloadId: 'id', releasePage: 'https://github.com/baiguidong/moss/releases' };
const render = (patch = {}) => renderToStaticMarkup(<UpdateContent state={{ ...state, ...patch }} actions={actions} />);

test('macOS only offers DMG opening and explains manual replacement', () => {
  const html = render();
  expect(html).toContain('下载完成'); expect(html).toContain('打开安装包'); expect(html).toContain('在 Finder 中显示');
  expect(html).toContain('完全退出 Moss'); expect(html).toContain('拖到');
  expect(html).not.toContain('安装并重启'); expect(html).not.toContain('安装成功');
});
test('NSIS offers explicit installation and Portable only reveals the download', () => {
  const html = render({ capabilities: { ...state.capabilities, platform: 'win32', mode: 'nativeUpdater', packageType: 'nsis' } });
  expect(html).toContain('安装并重启'); expect(html).toContain('普通退出不会自动安装');
  const portable = render({ capabilities: { ...state.capabilities, platform: 'win32', packageType: 'portable' } });
  expect(portable).toContain('手动替换'); expect(portable).not.toContain('安装并重启'); expect(portable).not.toContain('打开安装包');
});
test('failed checks show error and retry without a latest-version assertion', () => {
  const html = render({ phase: 'error', downloadId: undefined, retry: 'check', error: 'offline' });
  expect(html).toContain('offline'); expect(html).toContain('重试'); expect(html).not.toContain('已是最新版本');
});
test('verification has no install/open button; release notes are escaped', () => {
  const html = render({ phase: 'verifying', notes: '<script>alert(1)</script>' });
  expect(html).toContain('正在校验'); expect(html).not.toContain('>打开安装包<'); expect(html).not.toContain('<script>');
});
test('macOS ZIP installs in-app and exposes its full path on installation failure', () => {
  const capabilities = { ...state.capabilities, mode: 'nativeUpdater', packageType: 'zip' };
  const downloaded = render({ capabilities });
  expect(downloaded).toContain('安装并重启');
  expect(downloaded).not.toContain('打开 DMG');
  const downloadPath = '/Users/test/Library/Application Support/Moss/updates/id/Moss-1.2.0-arm64-mac.zip';
  const failed = render({ capabilities, phase: 'error', retry: 'install', downloadPath });
  expect(failed).toContain(downloadPath);
  expect(failed).toContain('解压 ZIP');
  expect(failed).toContain('在 Finder 中显示');
});

test('offers a download decision with the target changelog before and during download', () => {
  const notes = '修复窗口恢复';
  const available = render({ phase: 'available', downloadId: undefined, notes });
  for (const label of ['下载更新', '跳过此版本', notes]) expect(available).toContain(label);
  expect(render({ phase: 'downloading', downloadId: undefined, notes })).toContain(notes);
  expect(render({ phase: 'available', downloadId: undefined, skipped: true })).toContain('已跳过此版本');
});
