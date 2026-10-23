import * as React from 'react';
import { Button } from '@/components/ui/button';
import { ProjectAppDefaults } from './project-app-defaults';
import type { Project, PermissionMode } from '@/types';

export function ProjectDefaultsFields({ value, onChange }: { value: Partial<Project>; onChange: (patch: Partial<Project>) => void }) {
  const directories = value.workspaces || [];
  const addDirectory = async () => {
    const directory = await window.agentDesktop.pickDirectory();
    if (directory && !directories.includes(directory)) onChange({ workspaces: [...directories, directory], defaultWorkspace: value.defaultWorkspace || directory });
  };
  return <div className="grid gap-4">
    <p className="text-xs text-muted-foreground">配置只影响之后新建的会话，已有会话保留自己的设置。</p>
    <ProjectAppDefaults value={value} onChange={onChange} />
    <label className="grid gap-2 text-xs">默认权限
      <select className="rounded-md border border-border bg-background p-2" value={value.permissionMode || ''} onChange={event => onChange({ permissionMode: (event.target.value || null) as PermissionMode | null })}>
        {!value.permissionMode && <option value="">创建项目时继承全局</option>}
        <option value="plan">仅规划</option><option value="default">标准</option><option value="acceptEdits">自动编辑</option>
        <option value="dontAsk">不询问（需确认的操作拒绝）</option><option value="bypassPermissions">完全访问</option>
      </select>
    </label>
    <label className="grid gap-2 text-xs">默认模式
      <select className="rounded-md border border-border bg-background p-2" value={value.mode || 'boss'} onChange={event => onChange({ mode: event.target.value as 'chat' | 'boss' })}>
        <option value="boss">Boss</option><option value="chat">Chat</option>
      </select>
    </label>
    <div className="grid gap-2 text-xs"><span>项目工作目录</span>
      {!directories.length && <p className="text-muted-foreground">创建时自动建立一个默认目录。</p>}
      {directories.map(directory => <div key={directory} className="flex min-w-0 items-center gap-2">
        <input type="radio" name={`default-workspace-${value.id || 'new'}`} aria-label={`默认目录 ${directory}`} checked={(value.defaultWorkspace || directories[0]) === directory} onChange={() => onChange({ defaultWorkspace: directory })} />
        <span className="min-w-0 flex-1 break-all">{directory}</span>
        <button type="button" aria-label={`移除目录 ${directory}`} onClick={() => { const next = directories.filter(item => item !== directory); onChange({ workspaces: next, defaultWorkspace: value.defaultWorkspace === directory ? next[0] || null : value.defaultWorkspace }); }}>移除</button>
      </div>)}
      <Button type="button" size="sm" variant="outline" onClick={() => void addDirectory()}>选择目录</Button>
    </div>
    <details open><summary className="cursor-pointer text-xs font-medium">高级设置</summary>
      <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={value.agentTeamsEnabled !== false} onChange={event => onChange({ agentTeamsEnabled: event.target.checked })} />Agent Teams 智能体团队</label>
      <p className="mt-1 text-xs text-muted-foreground">项目默认开启，优先于全局设置；会话创建后保留该值。</p>
    </details>
  </div>;
}
