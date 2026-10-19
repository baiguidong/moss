import * as React from 'react';
import { draftScope, listDrafts, writeDraft } from './web-drafts';
import type { PreviewDocumentState, WorkspacePreviewData } from '@/types';

type DocumentController = {
  key: string; clientId: string; state?: PreviewDocumentState; queue: Promise<unknown>;
  frozen: boolean; offline: boolean; active: boolean; editVersion: number; syncedVersion: number;
  connectionVersion: number;
  flush: () => Promise<void>;
  publish: (state: PreviewDocumentState, file?: WorkspacePreviewData) => Promise<void>;
};
// Failed I/O must not poison future edits. Callers still observe their own failure.
function enqueue<T>(current: DocumentController, operation: () => Promise<T>): Promise<T> {
  const result = current.queue.catch(() => {}).then(operation);
  current.queue = result;
  void result.catch(() => {});
  return result;
}

export function usePreviewDocument(file: WorkspacePreviewData | null, updateTab: (path: string, patch: Partial<WorkspacePreviewData>) => void) {
  const metadata = file?.metadata || {};
  const enabled = Boolean(file && !file.path.startsWith('preview:') && !metadata.remote && metadata.sessionId && metadata.previewEditable !== false && !file.truncated && ['text', 'code', 'markdown', 'html', 'diff', 'ofv', 'unsupported'].includes(file.contentType));
  const key = enabled ? String(metadata.sessionId) + ':' + file.path : '';
  const [entry, setEntry] = React.useState<{ key: string; state: PreviewDocumentState } | null>(null);
  const [recovery, setRecovery] = React.useState<{ local: string; host: string } | null>(null);
  const [notice, setNotice] = React.useState(''), [frozen, setFrozen] = React.useState(false);
  const controller = React.useRef<DocumentController | null>(null);
  const updateRef = React.useRef(updateTab); updateRef.current = updateTab;

  React.useEffect(() => {
    if (!key) { controller.current = null; setNotice(''); setRecovery(null); return; }
    const api = window.agentDesktop.previewDocument;
    const current: DocumentController = { key, clientId: crypto.randomUUID(), queue: Promise.resolve(), frozen: false, offline: false, active: true, editVersion: 0, syncedVersion: 0, connectionVersion: 0, flush: async () => {}, publish: async () => {} };
    controller.current = current; setEntry(null); setNotice(''); setFrozen(false); setRecovery(null);
    const publish = async (state: PreviewDocumentState, savedFile?: WorkspacePreviewData) => {
      if (!current.active) {
        if (state.client && state.owner === state.client) await api.release({ id: state.id, generation: state.generation, clientId: current.clientId });
        return;
      }
      if (current.offline) return;
      if (current.state && state.sequence < current.state.sequence) return;
      if (current.state && current.state.owner !== state.owner) { current.frozen = false; setFrozen(false); }
      current.state = { ...state, client: state.client || current.state?.client };
      setEntry({ key, state: current.state });
      updateRef.current(file.path, { ...savedFile, content: state.content, metadata: { ...metadata, ...savedFile?.metadata, originalContent: state.originalContent, dirty: state.dirty } });
    };
    current.publish = publish;
    current.flush = async () => {
      if (current.offline) throw new Error('连接中断，草稿已保留');
      if (!current.state || current.editVersion === current.syncedVersion) return;
      const version = current.editVersion, state = current.state, clientId = current.clientId, connectionVersion = current.connectionVersion;
      await api.update({ id: state.id, generation: state.generation, clientId: current.clientId, content: state.content });
      if (current.offline || current.clientId !== clientId || current.connectionVersion !== connectionVersion) return;
      current.syncedVersion = version;
      const scope = window.mossWeb ? draftScope() : '';
      if (scope && current.editVersion === version) void writeDraft({ id: JSON.stringify([scope, 'preview:' + key, clientId]), scope, session: 'preview:' + key, tab: clientId, updatedAt: Date.now(), value: {} }).catch(() => {});
      if (current.active) setNotice('');
    };
    const changed = api.on('changed', state => {
      if (current.offline) return;
      if (state.id !== current.state?.id) return;
      // Our in-flight keystrokes take precedence over a broadcast of an earlier write.
      if (state.owner === current.state.client && state.generation === current.state.generation) return;
      void publish(state);
      if (!state.owner && current.active) {
      void enqueue(current, async () => {
          if (current.active && !current.offline) { const version = current.connectionVersion; const state = await api.acquire({ sessionId: String(metadata.sessionId), filePath: file.path, clientId: current.clientId }); if (version === current.connectionVersion) await publish(state); }
        }).catch(error => { if (current.active) setNotice(String(error)); });
      }
    });
    const prepare = api.on('prepare-transfer', event => {
      if (current.offline) return;
      if (event.id !== current.state?.id || event.owner !== current.state.client) return;
      current.frozen = true; setFrozen(true);
      void enqueue(current, async () => { await current.flush(); await api.acknowledge({ id: event.id, transferId: event.transferId, clientId: current.clientId }); }).catch(error => { if (current.active) setNotice(String(error)); });
    });
    const ended = api.on('transfer-ended', event => {
      if (current.offline) return;
      if (event.id !== current.state?.id || event.released) return;
      current.frozen = false; setFrozen(false);
    });
    const scope = window.mossWeb ? draftScope() : '';
    const draftKey = 'preview:' + key;
    const recover = async (reconnect = false) => {
      if (!current.active) return;
      const connectionVersion = current.connectionVersion;
      const local = current.editVersion !== current.syncedVersion ? current.state?.content : undefined;
      current.frozen = true; setFrozen(true);
      if (reconnect) current.clientId = crypto.randomUUID();
      const clientId = current.clientId;
      const state = await api.acquire({ sessionId: String(metadata.sessionId), filePath: file.path, clientId, takeOwnership: !reconnect && metadata.takeOwnership === true });
      if (!current.active || connectionVersion !== current.connectionVersion) {
        if (state.client && state.owner === state.client) await api.release({ id: state.id, generation: state.generation, clientId }).catch(() => {});
        return;
      }
      current.offline = false; current.state = undefined; current.editVersion = 0; current.syncedVersion = 0;
      current.frozen = false; setFrozen(false);
      await publish(state);
      const stored = scope ? await listDrafts<{ content: string }>(scope, draftKey).catch(() => []) : [];
      if (!current.active || connectionVersion !== current.connectionVersion) return;
      const recovered = local ?? stored.find(row => typeof row.value.content === 'string')?.value.content;
      if (recovered !== undefined && recovered !== state.content) {
        setRecovery({ local: recovered, host: state.content }); setNotice('未同步草稿已保留，请比较后选择要继续编辑的内容。');
      } else setNotice('');
    };
    const connection = (event: Event) => {
      if ((event as CustomEvent).detail === 'connected') return;
      current.connectionVersion++;
      current.offline = true; current.frozen = true; setFrozen(true); setNotice('连接中断，已暂停编辑和保存；未同步草稿已保留。');
    };
    const reconnected = () => { current.connectionVersion++; if (current.active) void enqueue(current, () => recover(true)).catch(error => { if (current.active) setNotice(String(error)); }); };
    window.addEventListener('moss:connection', connection); window.addEventListener('moss:reconnected', reconnected);
    void enqueue(current, () => recover()).catch(error => { if (current.active) setNotice(String(error)); });
    return () => {
      window.removeEventListener('moss:connection', connection); window.removeEventListener('moss:reconnected', reconnected);
      current.active = false; changed(); prepare(); ended();
      void enqueue(current, async () => {
        await current.flush();
        if (current.state) await api.release({ id: current.state.id, generation: current.state.generation, clientId: current.clientId });
      }).catch(() => {});
    };
  }, [key]);

  const state = entry?.key === key ? entry.state : null;
  const writable = !enabled || Boolean(state?.owner && state.owner === state.client && !frozen);
  const currentFile = React.useMemo(() => enabled && file ? { ...file, ...(state ? { content: state.content } : {}), metadata: { ...metadata, ...(state ? { originalContent: state.originalContent, dirty: state.dirty } : {}), previewEditable: writable, previewSaveable: writable } } : file, [file, state, writable, enabled]);
  const update = (path: string, patch: Partial<WorkspacePreviewData>) => {
    const current = controller.current;
    if (!enabled || path !== file.path) { updateTab(path, patch); return; }
    if (!current?.state || current.frozen || current.state.owner !== current.state.client) return;
    if (typeof patch.content !== 'string') { updateTab(path, patch); return; }
    const content = patch.content;
    const scope = window.mossWeb ? draftScope() : '';
    if (scope) void writeDraft({ id: JSON.stringify([scope, 'preview:' + key, current.clientId]), scope, session: 'preview:' + key, tab: current.clientId, updatedAt: Date.now(), value: { content } }).catch(() => { if (current.active) setNotice('浏览器草稿保存失败，请保持页面打开'); });
    current.editVersion++;
    current.state = { ...current.state, content, dirty: content !== current.state.originalContent };
    setEntry({ key, state: current.state }); updateTab(path, { ...patch, metadata: { ...metadata, ...patch.metadata, dirty: current.state.dirty, originalContent: current.state.originalContent } });
    void enqueue(current, current.flush).catch(error => { if (current.active) setNotice('草稿同步失败：' + String(error)); });
  };
  const save = enabled ? async () => {
    const current = controller.current;
    if (!current?.state || current.frozen) throw new Error('编辑尚未就绪');
    return enqueue(current, async () => {
      await current.flush();
      if (current.offline) throw new Error('连接中断，草稿已保留');
      const version = current.syncedVersion, state = current.state!, connectionVersion = current.connectionVersion;
      const result = await window.agentDesktop.previewDocument.save({ id: state.id, generation: state.generation, clientId: current.clientId, sessionId: String(metadata.sessionId) });
      if (current.offline || connectionVersion !== current.connectionVersion) return;
      // Keystrokes typed while save was in flight remain a draft against the new disk base.
      const content = version === current.editVersion ? result.state.content : current.state!.content;
      const saved = { ...result.state, client: state.client, content, dirty: content !== result.state.originalContent };
      if (current.active) await current.publish(saved, result.file);
      else current.state = saved; // Cleanup flush/release runs after this save.
    });
  } : undefined;
  const takeOwnership = async () => {
    const current = controller.current; if (!current || current.offline) return;
    try {
      await enqueue(current, async () => {
        if (current.offline) return;
        const version = current.connectionVersion;
        const state = await window.agentDesktop.previewDocument.acquire({ sessionId: String(metadata.sessionId), filePath: file.path, clientId: current.clientId, takeOwnership: true });
        if (version !== current.connectionVersion) return;
        await current.publish(state);
        if (current.active) setNotice('');
      });
    } catch (error) { if (current.active) setNotice(String(error)); }
  };
  const restoreRecovery = () => { if (recovery && writable) { update(file!.path, { content: recovery.local }); setRecovery(null); setNotice('已恢复为当前草稿，请审阅后保存。'); } };
  return { file: currentFile, update, save, notice, recovery, restoreRecovery, dismissRecovery: () => setRecovery(null), readOnly: enabled && state && !writable, takeOwnership };
}
