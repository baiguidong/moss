import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';

function sessionId(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/.test(value)) {
    throw new Error('无效的 Trace 会话 ID');
  }
  return value;
}

function targetOf(payload) {
  if (payload.target !== undefined && payload.target !== 'local' && payload.target !== 'remote') {
    throw new Error('无效的 Trace 数据来源');
  }
  return payload.target || 'local';
}

function metadata(record) {
  return record ? {
    id: record.id,
    title: record.title || '未命名会话',
    projectPath: record.workspace || '',
    workDir: record.workspace || null,
  } : null;
}

export function createTraceHandlers({ mossHome, getRuntime, getSessions, getTranscriptPath, requestRemote }) {
  const localRecords = () => [...getSessions()].filter(record => record.agentMode !== 'remote-direct');
  const lookup = (id) => localRecords().find(record => record.id === id || record.underlyingSessionId === id);
  const inLocalScope = async (fn) => {
    const runtime = await getRuntime();
    if (typeof runtime.withTraceScope !== 'function') throw new Error('请重新构建 Moss 运行时以启用 Trace');
    return runtime.withTraceScope(mossHome, () => fn(runtime));
  };
  const resolveId = (payload) => {
    const id = sessionId(payload.sessionId);
    const record = lookup(id);
    return { id: record?.underlyingSessionId || id, record };
  };
  const readMessages = async (runtime, record) => {
    const entries = [];
    const path = record && getTranscriptPath(record);
    if (path) {
      try {
        for (const line of (await fs.readFile(path, 'utf8')).split('\n')) {
          if (!line.trim()) continue;
          try { entries.push(JSON.parse(line)); } catch { /* An active transcript may end with a partial line. */ }
        }
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    return runtime.toTraceMessages(entries, record?.history || []);
  };
  const remote = (operation, payload) => requestRemote(operation, payload);
  return {
    settings: (payload = {}) => targetOf(payload) === 'remote'
      ? remote('settings', payload) : inLocalScope(runtime => runtime.readTraceCaptureSettings()),
    'update-settings': (payload = {}) => {
      if (typeof payload.enabled !== 'boolean') throw new Error('Trace 开关必须为布尔值');
      return targetOf(payload) === 'remote' ? remote('update-settings', payload)
        : inLocalScope(runtime => runtime.updateTraceCaptureSettings({ enabled: payload.enabled }));
    },
    list: (payload = {}) => {
      if (targetOf(payload) === 'remote') return remote('list', payload);
      return inLocalScope(async runtime => {
        const query = typeof payload.query === 'string' ? payload.query.trim().toLowerCase() : '';
        const limit = Number.isFinite(payload.limit) ? Math.max(1, Math.min(200, Math.floor(payload.limit))) : 50;
        const offset = Number.isFinite(payload.offset) ? Math.max(0, Math.floor(payload.offset)) : 0;
        let matchingIds;
        if (query) {
          const { files } = await runtime.traceCaptureService.listSessionTraceFiles();
          matchingIds = files.filter(file => {
            const record = lookup(file.sessionId);
            return [file.sessionId, record?.id, record?.title, record?.workspace]
              .some(value => typeof value === 'string' && value.toLowerCase().includes(query));
          }).map(file => file.sessionId);
        }
        const result = await runtime.traceCaptureService.listSessionTraces({ limit, offset, ...(matchingIds ? { sessionIds: matchingIds } : {}) });
        return { ...result, traces: result.traces.map(item => ({ ...item, session: metadata(lookup(item.sessionId)) })) };
      });
    },
    get: (payload = {}) => {
      sessionId(payload.sessionId);
      if (targetOf(payload) === 'remote') return remote('get', payload);
      return inLocalScope(async runtime => {
        const { id, record } = resolveId(payload);
        const [trace, messages] = await Promise.all([
          runtime.traceCaptureService.getSessionTrace(id), readMessages(runtime, record),
        ]);
        return {
          ...trace,
          calls: trace.calls.map(call => runtime.trimTraceCallPreviews(call)),
          session: metadata(record),
          messages,
          messageSignature: createHash('sha256').update(JSON.stringify(messages)).digest('hex'),
        };
      });
    },
    revision: (payload = {}) => {
      sessionId(payload.sessionId);
      if (targetOf(payload) === 'remote') return remote('revision', payload);
      return inLocalScope(async runtime => {
        const { id, record } = resolveId(payload);
        const revision = await runtime.traceCaptureService.getSessionTraceRevision(id);
        const transcriptPath = record && getTranscriptPath(record);
        const stat = transcriptPath ? await fs.stat(transcriptPath).catch(error => {
          if (error.code === 'ENOENT') return null;
          throw error;
        }) : null;
        const revisionToken = `${revision.revisionToken}:${stat?.dev || 0}:${stat?.ino || 0}:${stat?.mtimeMs || 0}:${stat?.ctimeMs || 0}:${stat?.size || 0}:${record?.history?.length || 0}:${record?.updatedAt || 0}`;
        return { ...revision, revisionToken, changed: payload.sinceRevisionToken !== revisionToken };
      });
    },
    call: (payload = {}) => {
      sessionId(payload.sessionId);
      sessionId(payload.callId);
      if (targetOf(payload) === 'remote') return remote('call', payload);
      return inLocalScope(async runtime => {
        const result = await runtime.traceCaptureService.getSessionTraceCall(resolveId(payload).id, payload.callId);
        if (!result) throw new Error('找不到该模型调用的 Trace');
        return result;
      });
    },
    delete: (payload = {}) => {
      sessionId(payload.sessionId);
      if (targetOf(payload) === 'remote') return remote('delete', payload);
      return inLocalScope(runtime => runtime.traceCaptureService.deleteSessionTrace(resolveId(payload).id));
    },
  };
}

export function registerTraceIpc({ ipcMain, getWindow, ...options }) {
  const handlers = createTraceHandlers(options);
  for (const [operation, handler] of Object.entries(handlers)) {
    ipcMain.handle(`trace:${operation}`, (event, payload = {}) => {
      const window = getWindow();
      if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Trace 请求来源无效');
      }
      return handler(payload || {});
    });
  }
  return handlers;
}
