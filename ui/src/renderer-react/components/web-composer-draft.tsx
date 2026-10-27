import * as React from 'react';
import { acknowledgeDrafts, draftScope, listDrafts, listPriorDrafts, writeDraft, type WebDraft } from '../lib/web-drafts';
import { composerIsEmpty, mergeRecoveredDraft, type ComposerDraft as Draft } from '../lib/composer-queue';

const empty = (value: Draft) => composerIsEmpty(value) && !value.queued?.length;
const signature = (value: Draft) => JSON.stringify({ text: value.text, files: value.files,
  appSelection: value.appSelection ?? null, choices: value.choices ?? { skills: [], agent: null },
  intent: value.intent ?? 'chat', workspace: value.workspace, queued: value.queued ?? [] });
const currentScope = () => window.mossWeb ? draftScope() : JSON.stringify(['desktop']);
// Session switches remount the component, but the page remains the same writer.
const pageWriterId = crypto.randomUUID();

export function WebComposerDraft({ session, value, restore }: { session: string; value: Draft; restore: (value: Draft) => void }) {
  const writer = React.useRef(pageWriterId);
  const tab = React.useMemo(() => {
    try {
      const key = 'moss-draft-tab', existing = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, existing); return existing;
    } catch { return writer.current; }
  }, []);
  const [scope, setScope] = React.useState(currentScope);
  const key = JSON.stringify([scope, session, tab]);
  const [ready, setReady] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState('');
  const [dismissed, setDismissed] = React.useState(false);
  const [prior, setPrior] = React.useState<WebDraft<Draft>[]>([]);
  const [alternatives, setAlternatives] = React.useState<WebDraft<Draft>[]>([]);
  const current = React.useRef({ value, restore }); current.current = { value, restore };
  const initial = React.useRef(signature(value));
  const saved = React.useRef<WebDraft<Draft>[]>([]);
  const acknowledgedAfterSave = React.useRef<WebDraft<Draft>[]>([]);
  const revision = signature(value);
  React.useEffect(() => {
    const connected = () => setScope(currentScope());
    window.addEventListener('moss:reconnected', connected);
    return () => window.removeEventListener('moss:reconnected', connected);
  }, []);
  React.useEffect(() => {
    if (!scope) return;
    let active = true;
    setDismissed(false);
    setNotice(''); setPrior([]); setAlternatives([]);
    saved.current = [];
    acknowledgedAfterSave.current = [];
    setReady(null); initial.current = signature(current.current.value);
    if (window.mossWeb) void listPriorDrafts<Draft>(scope).then(records => { if (active) setPrior(records.filter(row => !row.noticeAcknowledged && !empty(row.value))); }).catch(() => {});
    void listDrafts<Draft>(scope, session).then(records => {
      if (!active) return;
      saved.current = records;
      const own = records.find(row => row.tab === tab);
      const latest = own || records[0];
      // Never replace text typed while IndexedDB was loading.
      const canRestore = latest && !empty(latest.value) && empty(current.current.value) && signature(current.current.value) === initial.current;
      if (canRestore) {
        current.current.restore(latest.value);
      }
      // restore() updates React on the next render. Compare with the recovered
      // snapshot now, otherwise identical copies look like other saved drafts.
      const restoredSignature = signature(canRestore ? latest.value : current.current.value);
      acknowledgedAfterSave.current = records.filter(row => signature(row.value) === restoredSignature);
      const latestByTab = new Map<string, WebDraft<Draft>>();
      for (const row of records) if (!latestByTab.has(row.tab)) latestByTab.set(row.tab, row);
      const seen = new Set([restoredSignature]);
      setAlternatives([...latestByTab.values()].filter(row => {
        const content = signature(row.value);
        if (row.noticeAcknowledged || empty(row.value) || seen.has(content)) return false;
        seen.add(content); return true;
      }));
      setReady(key);
    }).catch(() => { if (active) { setDismissed(false); setNotice('浏览器未能保存草稿，请保持此页面打开。'); } });
    return () => { active = false; };
  }, [scope, session, tab, key]);
  React.useEffect(() => {
    if (ready !== key || !scope) return;
    const acknowledged = acknowledgedAfterSave.current; acknowledgedAfterSave.current = [];
    void writeDraft({ id: JSON.stringify([scope, session, writer.current]), scope, session, tab, updatedAt: Date.now(), value })
      .then(() => acknowledgeDrafts(acknowledged))
      .catch(() => { setDismissed(false); setNotice('草稿保存失败，请保持此页面打开。'); });
  }, [ready, scope, session, revision, tab, key]);
  const copies = (rows: WebDraft<Draft>[]) => {
    const contentKey = (row: WebDraft<Draft>) => JSON.stringify([row.scope, row.session, signature(row.value)]);
    const keys = new Set(rows.map(contentKey));
    return [...new Map([...rows, ...saved.current].filter(row => keys.has(contentKey(row))).map(row => [row.id, row])).values()];
  };
  const dismiss = () => {
    setDismissed(true);
    void acknowledgeDrafts(copies([...alternatives, ...prior])).catch(() => {
      setDismissed(false); setNotice('未能记住收起状态，请重试。');
    });
  };
  if (dismissed || (!notice && !alternatives.length && !prior.length)) return null;
  return <div className="fixed bottom-2 left-1/2 z-40 max-w-md -translate-x-1/2 rounded border bg-background px-3 py-1 text-xs shadow" role="status">
    {notice}
    {prior.length > 0 && <details><summary>恢复前草稿（{prior.length}）</summary>{prior.map(row => <div key={row.id} className="my-2"><p className="line-clamp-2">{row.value.text || '含附件的草稿'}</p><button className="underline" onClick={() => { acknowledgedAfterSave.current.push(...copies([row])); current.current.restore({ ...current.current.value, text: [current.current.value.text, row.value.text].filter(Boolean).join('\n') }); setPrior(items => items.filter(item => item.id !== row.id)); }}>复制文字到当前输入</button><p>附件路径可能已变化，请重新选择附件。</p></div>)}</details>}

    {alternatives.length > 0 && <details><summary>其他已保存草稿（{alternatives.length}）</summary>{alternatives.map(row => <div key={row.id} className="my-2">
      <p className="line-clamp-2">{row.value.text || `${row.value.files.length} 个附件`}</p>
      <button className="underline" onClick={() => { acknowledgedAfterSave.current.push(...copies([row])); current.current.restore(mergeRecoveredDraft(current.current.value, row.value, `recovered:${row.id}`)); setAlternatives(items => items.filter(item => item.id !== row.id)); }}>恢复为独立草稿</button>
    </div>)}</details>}
    <button className="ml-2 underline" onClick={dismiss}>收起提示</button>
  </div>;
}
