import fs from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const TEST_APP_ID = 'moss.self-test';
export const TEST_BROWSER_SERVER = 'moss_test_browser';
// Self-test sessions use the normal tool set with full permission bypass.
export const TEST_ALLOWED_TOOLS = null;

export function validateTestToolUse(record, active, name) {
  if (!record?.appTestRunId) return null;
  if (name.startsWith(`mcp__${TEST_BROWSER_SERVER}__`) &&
    !active) {
    return { behavior: 'deny', message: '本轮测试实例已关闭，无法继续使用其浏览器连接。' };
  }
  return null;
}

const closingControllers = new WeakMap();
export function closeTestController(runtime) {
  if (!runtime) return Promise.resolve();
  if (closingControllers.has(runtime)) return closingControllers.get(runtime);
  const pending = (async () => {
    runtime.abort();
    try {
      const clients = runtime.getAppState?.()?.mcp?.clients || [];
      await Promise.all(clients.filter(client => client.name === TEST_BROWSER_SERVER && client.type === 'connected').map(client => client.cleanup()));
    } finally { await runtime.dispose(); }
  })();
  closingControllers.set(runtime, pending);
  return pending;
}

export function restoreTestController(record) {
  if (!record || record.appTestRunId || !record.sessionDir) return;
  const marker = path.join(record.sessionDir, 'app-test-controller.json');
  if (!existsSync(marker)) return;
  const { runId, instanceId } = JSON.parse(readFileSync(marker, 'utf8'));
  if (!/^[a-f0-9-]{36}$/.test(runId)) throw new Error('自测会话标识无效。');
  record.appTestRunId = runId;
  record.appTestInstanceId = instanceId;
  // CDP endpoints are ephemeral. A restored conversation must never fall back to Chrome.
  record.appTestMcpServers = {};
}

