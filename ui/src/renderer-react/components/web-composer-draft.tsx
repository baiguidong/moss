import * as React from 'react';
import { draftScope, listDrafts, listPriorDrafts, writeDraft, type WebDraft } from '../lib/web-drafts';

type Draft = { text: string; files: Array<{ name: string; path: string; resource?: any }>; appSelection?: any };
const empty = (value: Draft) => !value.text && !value.files.length && !value.appSelection;
const signature = (value: Draft) => JSON.stringify(value);

export function WebComposerDraft({ session, value, restore }: { session: string; value: Draft; restore: (value: Draft) => void }) {
  const writer = React.useRef(crypto.randomUUID());
  const tab = React.useMemo(() => {
    try {
      const key = 'moss-draft-tab', existing = sessionStorage.getItem(key) || crypto.randomUUID();
      sessionStorage.setItem(key, existing); return existing;
    } catch { return writer.current; }
  }, []);
  const [scope, setScope] = React.useState(draftScope);
  const [ready, setReady] = React.useState(false);
  const [notice, setNotice] = React.useState('');
  const [prior, setPrior] = React.useState<WebDraft<Draft>[]>([]);
  const [alternatives, setAlternatives] = React.useState<WebDraft<Draft>[]>([]);
  const current = React.useRef({ value, restore }); current.current = { value, restore };
  const initial = React.useRef(signature(value));
  const replace = React.useRef<string | undefined>(undefined);
  const revision = signature(value);
  React.useEffect(() => {
    const connected = () => setScope(draftScope());
    window.addEventListener('moss:reconnected', connected);
    return () => window.removeEventListener('moss:reconnected', connected);
  }, []);
  React.useEffect(() => {
    if (!scope) return;
    let active = true;
    setReady(false); initial.current = signature(current.current.value);
    void listPriorDrafts<Draft>(scope).then(records => { if (active) setPrior(records.filter(row => !empty(row.value))); }).catch(() => {});
    void listDrafts<Draft>(scope, session).then(records => {
      if (!active) return;
      const own = records.find(row => row.tab === tab);
      const latest = own || records[0];
      // Never replace text typed while IndexedDB was loading.
      if (latest && !empty(latest.value) && empty(current.current.value) && signature(current.current.value) === initial.current) {
        current.current.restore(latest.value); replace.current = own?.id;
        setNotice('已恢复草稿');
      }
      setAlternatives(records.filter(row => row.id !== latest?.id && !empty(row.value)));
      setReady(true);
    }).catch(() => { if (active) setNotice('浏览器未能保存草稿，请保持此页面打开。'); });
    return () => { active = false; };
  }, [scope, session, tab]);
  React.useEffect(() => {
    if (!ready || !scope) return;
    const replaceId = replace.current; replace.current = undefined;
    void writeDraft({ id: JSON.stringify([scope, session, writer.current]), scope, session, tab, updatedAt: Date.now(), value }, replaceId)
      .catch(() => setNotice('草稿保存失败，请保持此页面打开。'));
  }, [ready, scope, session, revision, tab]);
  if (!window.mossWeb || (!notice && !alternatives.length && !prior.length)) return null;
  return <div className="fixed bottom-2 left-1/2 z-40 max-w-md -translate-x-1/2 rounded border bg-background px-3 py-1 text-xs shadow" role="status">
    {notice}
    {prior.length > 0 && <details><summary>恢复前草稿（{prior.length}）</summary>{prior.map(row => <div key={row.id} className="my-2"><p className="line-clamp-2">{row.value.text || '含附件的草稿'}</p><button className="underline" onClick={() => { current.current.restore({ ...current.current.value, text: [current.current.value.text, row.value.text].filter(Boolean).join('\n') }); setPrior(items => items.filter(item => item.id !== row.id)); }}>复制文字到当前输入</button><p>附件路径可能已变化，请重新选择附件。</p></div>)}</details>}

    {alternatives.length > 0 && <details><summary>其他标签的草稿（{alternatives.length}）</summary>{alternatives.map(row => <div key={row.id} className="my-2">
      <p className="line-clamp-2">{row.value.text || `${row.value.files.length} 个附件`}</p>
      <button className="underline" onClick={() => { current.current.restore({ ...row.value, text: [current.current.value.text, row.value.text].filter(Boolean).join('\n'), files: [...current.current.value.files, ...row.value.files] }); setAlternatives(items => items.filter(item => item.id !== row.id)); }}>合并到当前输入</button>
    </div>)}</details>}
    <button className="ml-2 underline" onClick={() => setNotice('')}>收起提示</button>
  </div>;
}
