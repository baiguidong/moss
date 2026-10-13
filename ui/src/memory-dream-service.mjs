import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** One global maintenance job, independent of the selected conversation. */
export function createMemoryDreamService({ mossHome, transcriptDir, getSettings, getRuntimeModule, prepareRuntime = async () => {} }) {
  let status = { phase: 'idle', message: '', result: null };
  let controller = null;
  let pending = Promise.resolve();
  const getStatus = () => structuredClone(status);

  async function run(settings, signal) {
    let runtime;
    let workDir;
    try {
      await prepareRuntime();
      signal.throwIfAborted();
      const { ClaudeSession } = await getRuntimeModule();
      workDir = await mkdtemp(path.join(tmpdir(), 'moss-memory-dream-'));
      signal.throwIfAborted();
      runtime = new ClaudeSession({
        cwd: mossHome,
        projectDir: workDir,
        model: settings.model,
        fastModel: settings.fastModel || undefined,
        url: settings.url || undefined,
        apiKey: settings.apiKey || undefined,
        permissionMode: 'dontAsk',
        mcpServers: {},
        addDirs: [],
        allowedTools: ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'],
        coordinatorMode: false,
        environment: {
          MOSS_TRACE_SCOPE: mossHome,
          MOSS_RUNTIME_AUTO_MEMORY_SETTINGS: JSON.stringify(settings.autoMemory),
          MOSS_RUNTIME_SESSION_MEMORY_SETTINGS: JSON.stringify({ enabled: false }),
          MOSS_RUNTIME_ADVANCED_SETTINGS: JSON.stringify({
            ...settings.advanced,
            moss_response_language: settings.language,
          }),
        },
      });
      status = { ...status, message: '正在合并、修正和精简本机长期记忆…' };
      const result = await runtime.consolidateMemory({ signal, transcriptDir });
      signal.throwIfAborted();
      status = { ...status, phase: 'completed', message: '长期记忆整理完成。', result };
    } catch (error) {
      status = {
        ...status,
        phase: signal.aborted ? 'canceled' : 'failed',
        message: signal.aborted ? '已停止整理；已经保存的记忆仍会保留。' : error instanceof Error ? error.message : String(error),
      };
    } finally {
      try { await runtime?.dispose(); } catch { /* Keep the original run outcome. */ } finally {
        if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
        controller = null;
      }
    }
  }

  return {
    getStatus,
    start() {
      if (controller) return getStatus();
      const settings = structuredClone(getSettings());
      if (settings.autoMemory?.enabled === false) throw new Error('请先开启长期记忆。');
      if (!settings.model?.trim()) throw new Error('请先配置文本模型。');
      controller = new AbortController();
      status = { phase: 'running', message: '正在准备长期记忆整理…', result: null };
      pending = run(settings, controller.signal);
      return getStatus();
    },
    stop() {
      if (controller) {
        status = { ...status, phase: 'stopping', message: '正在停止整理…' };
        controller.abort();
      }
      return getStatus();
    },
    waitForIdle: () => pending,
  };
}

export function registerMemoryDreamIpc(ipcMain, service) {
  ipcMain.handle('memory:dream-status', () => service.getStatus());
  ipcMain.handle('memory:dream-start', () => service.start());
  ipcMain.handle('memory:dream-stop', () => service.stop());
}
