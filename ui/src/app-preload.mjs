import { contextBridge, ipcRenderer } from 'electron';

const gooseApp = {
  getAppInfo: () => ipcRenderer.invoke('app-runtime:get-info'),
  listTools: () => ipcRenderer.invoke('app-runtime:list-tools'),
  listResources: () => ipcRenderer.invoke('app-runtime:list-resources'),
  readResource: (uri) => ipcRenderer.invoke('app-runtime:read-resource', { uri }),
  callTool: (name, args) => ipcRenderer.invoke('app-runtime:call-tool', { name, args }),
  storage: {
    get: (key) => ipcRenderer.invoke('app-runtime:storage:get', { key }),
    set: (key, value) => ipcRenderer.invoke('app-runtime:storage:set', { key, value }),
    remove: (key) => ipcRenderer.invoke('app-runtime:storage:remove', { key }),
    listKeys: () => ipcRenderer.invoke('app-runtime:storage:list'),
  },
  files: {
    list: (path) => ipcRenderer.invoke('app-runtime:files:list', { path }),
    readText: (path) => ipcRenderer.invoke('app-runtime:files:read-text', { path }),
    writeText: (path, content) =>
      ipcRenderer.invoke('app-runtime:files:write-text', { path, content }),
    delete: (path) => ipcRenderer.invoke('app-runtime:files:delete', { path }),
    mkdir: (path) => ipcRenderer.invoke('app-runtime:files:mkdir', { path }),
  },
  agent: {
    send: (payload) => ipcRenderer.invoke('app-runtime:agent:send', payload),
    cancel: (requestId) => ipcRenderer.invoke('app-runtime:agent:cancel', { requestId }),
    reset: () => ipcRenderer.invoke('app-runtime:agent:reset'),
  },
  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app-runtime:event', handler);
    return () => ipcRenderer.off('app-runtime:event', handler);
  },
};

contextBridge.exposeInMainWorld('gooseApp', gooseApp);

function formatOutput(value) {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(error);
  }
}

function installDebugPanel(api) {
  window.addEventListener('DOMContentLoaded', async () => {
    if (!document.body || document.getElementById('__goose_app_debug_host__')) {
      return;
    }

    const host = document.createElement('div');
    host.id = '__goose_app_debug_host__';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
        }
        .toggle {
          position: fixed;
          left: 14px;
          bottom: 14px;
          z-index: 2147483647;
          border: 0;
          border-radius: 999px;
          background: #111827;
          color: #f9fafb;
          padding: 10px 14px;
          font: 600 12px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.24);
          cursor: pointer;
        }
        .panel {
          position: fixed;
          left: 14px;
          bottom: 62px;
          width: min(420px, calc(100vw - 28px));
          max-height: min(70vh, 720px);
          overflow: hidden;
          z-index: 2147483647;
          border: 1px solid rgba(148, 163, 184, 0.26);
          border-radius: 16px;
          background: rgba(15, 23, 42, 0.96);
          color: #e5e7eb;
          box-shadow: 0 24px 60px rgba(0, 0, 0, 0.34);
          backdrop-filter: blur(14px);
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .hidden {
          display: none;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 14px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.16);
        }
        .title {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .title strong {
          font-size: 13px;
          font-weight: 700;
        }
        .title span {
          color: #94a3b8;
          font-size: 11px;
        }
        .close {
          border: 0;
          background: transparent;
          color: #94a3b8;
          cursor: pointer;
          font: inherit;
        }
        .section {
          padding: 12px 14px;
          border-bottom: 1px solid rgba(148, 163, 184, 0.12);
        }
        .section:last-of-type {
          border-bottom: 0;
        }
        .actions {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }
        .btn {
          border: 1px solid rgba(148, 163, 184, 0.2);
          background: rgba(30, 41, 59, 0.85);
          color: #f8fafc;
          border-radius: 10px;
          padding: 8px 10px;
          font: 600 12px/1.1 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          cursor: pointer;
        }
        .btn.primary {
          background: #2563eb;
          border-color: rgba(37, 99, 235, 0.8);
        }
        .prompt {
          width: 100%;
          min-height: 78px;
          resize: vertical;
          border: 1px solid rgba(148, 163, 184, 0.22);
          border-radius: 10px;
          background: rgba(15, 23, 42, 0.72);
          color: #f8fafc;
          padding: 10px;
          margin-top: 8px;
          box-sizing: border-box;
          font: 13px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }
        .prompt-actions {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 10px;
          margin-top: 8px;
        }
        .status {
          color: #93c5fd;
          font-size: 11px;
        }
        .output {
          margin: 0;
          padding: 12px 14px 14px;
          max-height: 220px;
          overflow: auto;
          white-space: pre-wrap;
          word-break: break-word;
          color: #dbeafe;
          background: rgba(2, 6, 23, 0.72);
          font: 12px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
        }
      </style>
      <button class="toggle" type="button">Goose Debug</button>
      <section class="panel hidden">
        <div class="header">
          <div class="title">
            <strong>Goose App Runtime</strong>
            <span class="subtitle">loading...</span>
          </div>
          <button class="close" type="button">关闭</button>
        </div>
        <div class="section">
          <div class="actions">
            <button class="btn" data-action="info" type="button">App Info</button>
            <button class="btn" data-action="meta" type="button">Meta 资源</button>
            <button class="btn" data-action="storage" type="button">Storage</button>
            <button class="btn" data-action="files" type="button">Files</button>
            <button class="btn" data-action="tools" type="button">Tools</button>
            <button class="btn" data-action="resources" type="button">Resources</button>
            <button class="btn" data-action="versions" type="button">Versions</button>
            <button class="btn" data-action="reset" type="button">重置 Agent</button>
          </div>
        </div>
        <div class="section">
          <div>Agent Prompt</div>
          <textarea class="prompt" placeholder="让内置 agent 帮 app 做一件事，例如：总结当前 app 的 PRD"></textarea>
          <div class="prompt-actions">
            <span class="status">host api: window.gooseApp</span>
            <button class="btn primary" data-action="agent" type="button">发送给 Agent</button>
          </div>
        </div>
        <pre class="output">Debug panel ready.</pre>
      </section>
    `;

    const toggle = shadow.querySelector('.toggle');
    const panel = shadow.querySelector('.panel');
    const close = shadow.querySelector('.close');
    const subtitle = shadow.querySelector('.subtitle');
    const output = shadow.querySelector('.output');
    const prompt = shadow.querySelector('.prompt');
    const status = shadow.querySelector('.status');
    let latestRequestId = '';

    const setOutput = (value) => {
      output.textContent = formatOutput(value);
    };

    const run = async (label, fn) => {
      status.textContent = `${label}...`;
      try {
        const result = await fn();
        setOutput(result);
        status.textContent = `${label} 完成`;
      } catch (error) {
        setOutput({ error: error instanceof Error ? error.message : String(error) });
        status.textContent = `${label} 失败`;
      }
    };

    toggle.addEventListener('click', () => {
      panel.classList.toggle('hidden');
    });

    close.addEventListener('click', () => {
      panel.classList.add('hidden');
    });

    shadow.querySelector('[data-action="info"]').addEventListener('click', () => {
      void run('读取 app 信息', () => api.getAppInfo());
    });

    shadow.querySelector('[data-action="meta"]').addEventListener('click', () => {
      void run('读取 meta 资源', () => api.readResource('app://meta'));
    });

    shadow.querySelector('[data-action="storage"]').addEventListener('click', () => {
      void run('读取 storage', async () => {
        const keys = await api.storage.listKeys();
        const values = {};
        for (const key of keys) {
          values[key] = await api.storage.get(key);
        }
        return { keys, values };
      });
    });

    shadow.querySelector('[data-action="files"]').addEventListener('click', () => {
      void run('列出 files', () => api.files.list('.'));
    });

    shadow.querySelector('[data-action="tools"]').addEventListener('click', () => {
      void run('列出 tools', () => api.listTools());
    });

    shadow.querySelector('[data-action="resources"]').addEventListener('click', () => {
      void run('列出 resources', () => api.listResources());
    });

    shadow.querySelector('[data-action="versions"]').addEventListener('click', () => {
      void run('列出 versions', () => api.readResource('app://versions'));
    });

    shadow.querySelector('[data-action="reset"]').addEventListener('click', () => {
      void run('重置 agent', () => api.agent.reset());
    });

    shadow.querySelector('[data-action="agent"]').addEventListener('click', () => {
      const value = prompt.value.trim();
      if (!value) {
        setOutput('先输入一条 prompt。');
        return;
      }
      void run('调用 agent', async () => {
        const started = await api.agent.send({ prompt: value, stream: true });
        latestRequestId = started.requestId || '';
        return started;
      });
    });

    api.onEvent((event) => {
      if (event?.type === 'agent:delta') {
        latestRequestId = event.requestId || latestRequestId;
        setOutput({
          requestId: latestRequestId,
          text: event.text,
          delta: event.delta,
          streaming: true,
        });
        status.textContent = 'Agent 正在流式返回';
        return;
      }
      if (event?.type === 'agent:complete') {
        latestRequestId = event.requestId || latestRequestId;
        setOutput(event);
        status.textContent = 'Agent 已完成';
        return;
      }
      if (event?.type === 'agent:error') {
        setOutput(event);
        status.textContent = 'Agent 执行失败';
        return;
      }
      if (event?.type === 'agent:cancelled') {
        setOutput(event);
        status.textContent = 'Agent 已取消';
        return;
      }
    });

    try {
      const info = await api.getAppInfo();
      subtitle.textContent = info?.name ? `${info.name} · ${info.hostApi}` : 'runtime ready';
    } catch {
      subtitle.textContent = 'runtime ready';
    }
  });
}

installDebugPanel(gooseApp);
