import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const BROWSER_AUTOMATION_ACTIONS = Object.freeze(new Set([
  'browser_snapshot',
  'browser_click',
  'browser_type',
  'browser_press',
  'browser_scroll',
  'browser_wait',
  'browser_reload',
]));

const ACTION_LABELS = Object.freeze({
  browser_snapshot: '读取页面并截图',
  browser_click: '点击页面元素',
  browser_type: '向页面输入内容',
  browser_press: '向页面发送按键',
  browser_scroll: '滚动页面',
  browser_wait: '等待并读取页面状态',
  browser_reload: '重新加载页面',
});

const SENSITIVE_URL_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'code',
  'state',
  'api_key',
  'apikey',
  'key',
  'password',
  'passwd',
  'secret',
  'client_secret',
  'authorization',
]);

export function isBrowserAutomationAction(action) {
  return BROWSER_AUTOMATION_ACTIONS.has(String(action || ''));
}

export function getBrowserAutomationOrigin(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol === 'file:') {
      url.search = '';
      url.hash = '';
      try {
        return pathToFileURL(fs.realpathSync.native(fileURLToPath(url))).href;
      } catch {
        return url.href;
      }
    }
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : url.href;
  } catch {
    return String(rawUrl || '').trim() || 'about:blank';
  }
}

export function isLocalDevelopmentBrowserUrl(rawUrl) {
  if (String(rawUrl || '').trim() === 'about:blank') return true;
  try {
    const url = new URL(String(rawUrl || ''));
    if (!['http:', 'https:'].includes(url.protocol)) return false;
    const hostname = url.hostname.toLowerCase();
    return hostname === 'localhost'
      || hostname === '127.0.0.1'
      || hostname === '::1'
      || hostname === '[::1]'
      || hostname.endsWith('.localhost');
  } catch {
    return false;
  }
}

export function isBrowserAutomationFileWithinRoot(rawUrl, rootPath) {
  let url;
  try {
    url = new URL(String(rawUrl || ''));
  } catch {
    return false;
  }
  if (url.protocol !== 'file:' || !rootPath) return false;
  try {
    const root = fs.realpathSync.native(path.resolve(rootPath));
    const file = fs.realpathSync.native(fileURLToPath(url));
    const relativePath = path.relative(root, file);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
  } catch {
    return false;
  }
}

export function describeBrowserAutomationAction(action) {
  return ACTION_LABELS[String(action || '')] || '操作页面';
}

export function redactBrowserAutomationUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    url.username = '';
    url.password = '';
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_URL_KEYS.has(key.toLowerCase())) url.searchParams.set(key, 'REDACTED');
    }
    url.hash = url.hash.replace(
      /([?&#](?:access_token|refresh_token|id_token|token|code|state|api_key|apikey|key|password|passwd|secret|client_secret|authorization)=)[^&#]*/gi,
      '$1REDACTED',
    );
    return url.toString();
  } catch {
    return String(rawUrl || '').trim();
  }
}
