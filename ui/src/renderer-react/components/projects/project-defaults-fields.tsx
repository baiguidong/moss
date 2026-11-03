import * as React from 'react';
import { ProjectWorkspaceFields } from './project-workspace-fields';
import { ProjectAppDefaults } from './project-app-defaults';
import type { Project, PermissionMode } from '@/types';

export function ProjectDefaultsFields({ value, onChange }: { value: Partial<Project>; onChange: (patch: Partial<Project>) => void }) {
  return <div className="grid gap-4">
    <ProjectAppDefaults value={value} onChange={onChange} />
    <label className="grid gap-2 text-xs">默认权限
      <select className="rounded-md border border-border bg-background p-2" value={value.permissionMode || 'bypassPermissions'} onChange={event => onChange({ permissionMode: (event.target.value || null) as PermissionMode | null })}>
        <option value="plan">仅规划</option><option value="default">标准</option><option value="acceptEdits">自动编辑</option>
        <option value="dontAsk">不询问（需确认的操作拒绝）</option><option value="bypassPermissions">完全访问</option>
      </select>
    </label>
    <label className="grid gap-2 text-xs">默认模式
      <select className="rounded-md border border-border bg-background p-2" value={value.mode || 'boss'} onChange={event => onChange({ mode: event.target.value as 'chat' | 'boss' })}>
        <option value="boss">Boss</option><option value="chat">Chat</option>
      </select>
    </label>
    <ProjectWorkspaceFields directories={value.workspaces || []} defaultDirectory={value.defaultWorkspace} onChange={(workspaces, defaultWorkspace) => onChange({ workspaces, defaultWorkspace })} />
    <details><summary className="cursor-pointer text-xs font-medium">高级设置</summary>
      <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={value.agentTeamsEnabled !== false} onChange={event => onChange({ agentTeamsEnabled: event.target.checked })} />Agent Teams 智能体团队</label>
    </details>
  </div>;
}
