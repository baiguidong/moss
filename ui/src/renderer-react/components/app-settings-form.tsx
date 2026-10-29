import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import type { StoredApp } from '@/types';

type Schema = Record<string, any>;
const inputClass = 'block w-full min-w-0 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring';

/** JSON Schema conditionals select fields; App packages supply no renderer code. */
export function settingsFormFields(schema: Schema, values: Record<string, any>): { properties: Record<string, Schema>; required: string[] } {
  const properties = { ...schema.properties }, required = [...(schema.required || [])];
  for (const branch of schema.allOf || []) {
    if (!branch.if?.properties) continue;
    const matches = Object.entries(branch.if.properties).every(([key, test]: [string, any]) =>
      Object.hasOwn(test, 'const') ? values[key] === test.const : test.enum?.includes(values[key]));
    const selected = matches ? branch.then : branch.else;
    if (selected) { const fields = settingsFormFields(selected, values); Object.assign(properties, fields.properties); required.push(...fields.required); }
  }
  return { properties, required };
}

function Description({ text, onError }: { text?: string; onError(message: string): void }) {
  if (!text) return null;
  return <span className="block whitespace-pre-line break-words text-xs leading-6 text-muted-foreground">{text.split(/(https?:\/\/[^\s）。，]+)/g).map((part, index) => /^https?:\/\//.test(part)
    ? <a key={index} href={part} className="text-primary underline" onClick={event => { event.preventDefault(); void window.agentDesktop.shell.openExternal(part).catch(cause => onError(cleanIpcErrorMessage(cause))); }}>{part}</a> : part)}</span>;
}

export function AppSettingsForm({ app, settingId, onBusyChange, onSaved, onClose }: {
  app: StoredApp; settingId: string; onBusyChange(busy: boolean): void; onSaved(): Promise<unknown>; onClose(): void;
}) {
  const [data, setData] = React.useState<Awaited<ReturnType<Window['agentDesktop']['appSettingsForm']>> | null>(null);
  const [values, setValues] = React.useState<Record<string, any>>({});
  const [error, setError] = React.useState(''), [busy, setBusy] = React.useState(false);
  const alive = React.useRef(true), working = React.useRef(false);
  const appId = app.id || app.name, version = app.currentVersion || app.currentVersionId || '';
  React.useEffect(() => {
    alive.current = true;
    let canceled = false;
    setData(null); setError('');
    void window.agentDesktop.appSettingsForm({ appId, version, settingId, operation: 'read' }).then(result => {
      if (!canceled) { setData(result); setValues(result.values); }
    }).catch(cause => { if (!canceled) setError(cleanIpcErrorMessage(cause)); });
    return () => { canceled = true; alive.current = false; onBusyChange(false); };
  }, [appId, version, settingId, onBusyChange]);
  if (!data) return <p role={error ? 'alert' : 'status'} className="p-5 text-sm text-muted-foreground">{error || '正在读取设置…'}</p>;
  const { properties, required } = settingsFormFields(data.schema, values);
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (working.current) return;
    working.current = true; setBusy(true); onBusyChange(true); setError('');
    try {
      const input = Object.fromEntries(Object.entries(properties).map(([key, field]) => [key, values[key] ?? field.default ?? (field.type === 'boolean' ? false : '')]));
      await window.agentDesktop.appSettingsForm({ appId, version, settingId, operation: 'save', values: input });
      if (alive.current) { await onSaved(); onClose(); }
    } catch (cause) { if (alive.current) setError(cleanIpcErrorMessage(cause)); }
    finally { working.current = false; if (alive.current) { setBusy(false); onBusyChange(false); } }
  };
  return <form aria-label={data.schema.title || '应用设置'} onSubmit={save} className="flex min-h-0 flex-1 flex-col">
    <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
      <Description text={data.schema.description} onError={setError} />
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      <fieldset disabled={busy} className="min-w-0 space-y-5">
        {Object.entries(properties).map(([key, field]) => {
          const choices = field.oneOf?.filter((item: Schema) => Object.hasOwn(item, 'const')) || field.enum?.map((value: unknown) => ({ const: value, title: String(value) }));
          const value = values[key] ?? field.default ?? '';
          const update = (next: unknown) => setValues(current => ({ ...current, [key]: next }));
          const attrs = { 'aria-label': field.title || key, required: required.includes(key), className: inputClass };
          return <label key={key} className="block min-w-0 space-y-2 text-sm"><span className="font-medium">{field.title || key}</span>
            {choices?.length ? <select {...attrs} value={String(value)} onChange={event => update(choices.find((item: Schema) => String(item.const) === event.target.value)?.const)}>{choices.map((item: Schema) => <option key={String(item.const)} value={String(item.const)}>{item.title || String(item.const)}</option>)}</select>
              : field.type === 'boolean' ? <input aria-label={attrs['aria-label']} type="checkbox" checked={Boolean(value)} onChange={event => update(event.target.checked)} className="ml-3 accent-primary" />
                : field.contentMediaType === 'text/plain' ? <textarea {...attrs} rows={4} value={String(value)} maxLength={field.maxLength} onChange={event => update(event.target.value)} />
                  : <input {...attrs} type={field.writeOnly ? 'password' : ['number', 'integer'].includes(field.type) ? 'number' : 'text'} autoComplete="off" spellCheck={false} value={String(value)} min={field.minimum} max={field.maximum} maxLength={field.maxLength} placeholder={data.configuredFields?.includes(key) ? '已保存，留空保留' : field.examples?.[0] || ''} onChange={event => update(['number', 'integer'].includes(field.type) ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value)} />}
            <Description text={choices?.find((item: Schema) => item.const === value)?.description || field.description} onError={setError} />
          </label>;
        })}
      </fieldset>
    </div>
    <footer className="flex shrink-0 justify-end gap-2 border-t px-5 py-4"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>取消</Button><Button type="submit" disabled={busy}>{busy && <Loader2 className="h-4 w-4 animate-spin" />}{busy ? '保存中' : '保存设置'}</Button></footer>
  </form>;
}
