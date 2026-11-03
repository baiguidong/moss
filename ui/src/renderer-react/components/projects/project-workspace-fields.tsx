import * as React from 'react';
import { Plus, FolderOpen, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function ProjectWorkspaceFields({ directories, defaultDirectory, onChange }: {
  directories: string[]; defaultDirectory?: string | null;
  onChange: (directories: string[], defaultDirectory: string | null) => void;
}) {
  const [input, setInput] = React.useState('');
  const [error, setError] = React.useState('');
  const id = React.useId();
  const add = (raw: string) => {
    const directory = raw.trim();
    if (!directory) return;
    if (!/^(\/|[a-zA-Z]:[\\/]|\\\\)/.test(directory)) { setError('请输入绝对路径'); return; }
    if (!directories.includes(directory)) onChange([...directories, directory], defaultDirectory || directory);
    setInput(''); setError('');
  };
  return <div className="grid min-w-0 gap-2 text-xs">
    <label htmlFor={id}>项目工作目录</label>
    {directories.map(directory => <div key={directory} className="flex min-w-0 items-center gap-2">
      <input type="radio" name={id} aria-label={`默认目录 ${directory}`} checked={(defaultDirectory || directories[0]) === directory} onChange={() => onChange(directories, directory)} />
      <span className="min-w-0 flex-1 break-all">{directory}</span>
      <button type="button" aria-label={`移除目录 ${directory}`} onClick={() => { const next = directories.filter(item => item !== directory); onChange(next, directory === (defaultDirectory || directories[0]) ? next[0] || null : defaultDirectory || null); }}><X className="h-3.5 w-3.5" /></button>
    </div>)}
    <div className="flex min-w-0 gap-1">
      <Input id={id} className="h-8 min-w-0 text-xs" value={input} placeholder={directories.length ? '添加目录路径' : '自动创建默认目录，或输入新路径'} onChange={event => setInput(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); add(input); } }} />
      <Button type="button" variant="ghost" size="icon-sm" aria-label="添加目录" disabled={!input.trim()} onClick={() => add(input)}><Plus className="h-4 w-4" /></Button>
      <Button type="button" variant="ghost" size="icon-sm" aria-label="选择目录" title="选择目录" onClick={() => void window.agentDesktop.pickDirectory().then(directory => { if (directory) add(directory); }).catch(error => setError(String(error)))}><FolderOpen className="h-4 w-4" /></Button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
