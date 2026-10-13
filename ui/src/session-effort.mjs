import { normalizeSessionEffort } from './shared/session-normalization.mjs';

export function registerSessionEffortIpc({ ipcMain, getSessionRecord, getRuntimeModule, getSettings, persist, emit }) {
  async function read(record) {
    if (record.agentMode === 'remote-direct') {
      if (record.runtime?.getEffort) return record.runtime.getEffort();
      throw new Error('云电脑连接后可设置推理强度。');
    }
    if (record.runtime?.getEffort) return record.runtime.getEffort();
    const runtime = await getRuntimeModule();
    return runtime.getSessionEffortConfiguration(getSettings().model, normalizeSessionEffort(record.effort) ?? undefined);
  }
  ipcMain.handle('agent:get-session-effort', (_event, { sessionId }) => read(getSessionRecord(sessionId)));
  ipcMain.handle('agent:set-session-effort', async (_event, { sessionId, effort }) => {
    if (effort !== null && normalizeSessionEffort(effort) === null) throw new Error('无效的推理强度。');
    const record = getSessionRecord(sessionId);
    if (record.isSubAgent || record.resumeReadOnlyReason) throw new Error('只读会话不能修改推理强度。');
    const previous = await read(record);
    if (previous.overridden) throw new Error('推理强度由环境变量指定，无法在会话中覆盖。');
    if (effort !== null && !previous.levels.includes(effort)) throw new Error('当前模型不支持此推理档位。');
    // Update the engine directly. This never submits a chat message.
    const result = record.runtime?.setEffort ? await record.runtime.setEffort(effort) : null;
    record.effort = effort;
    persist(record);
    emit(record);
    return result ?? read(record);
  });
}
