"use client";

import * as React from "react";
import {
  Bot,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  LoaderCircle,
  MoreHorizontal,
  PanelLeftClose,
  PanelRightClose,
  Plus,
  RefreshCw,
  Settings2,
  Trash2,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ProjectResourcePicker,
  type ProjectResourceOption,
} from "@/components/projects/project-resource-picker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { SessionTreeChildItem } from "@/components/session-tree-child-item";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type {
  GroupRoom,
  GroupRoomConnectorGrant,
  GroupRoomInviteable,
  GroupRoomMember,
  GroupRoomResourceConnector,
  GroupRoomResourceSkill,
  GroupRoomSummary,
  SessionSummary,
} from "../types";

const DEFAULT_MODERATOR_INSTRUCTIONS = "根据任务复杂度、成员专长、已有证据和分歧程度自主决定是否委派、委派给谁、串行或并行执行以及何时收敛。审查、方案、架构和风险判断中，如果第二意见能显著提高可靠性，应主动安排相关成员交叉验证；不要为凑人数调用无关成员。";

type Resources = {
  inviteables: GroupRoomInviteable[];
  connectors: GroupRoomResourceConnector[];
  skills: GroupRoomResourceSkill[];
};

function unwrap<T>(result: { success: boolean; data?: T; error?: string }): T {
  if (!result?.success || result.data === undefined) throw new Error(result?.error || "群聊操作失败");
  return result.data;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function selectedConnectorGrant(connector: GroupRoomResourceConnector): GroupRoomConnectorGrant {
  return { id: connector.id };
}

function memberSourceLabel(member: GroupRoomMember) {
  if (member.source.kind === "custom") return "自定义成员";
  if (member.source.kind === "expert-team") return `专家团 ${member.source.id}`;
  return `专家 ${member.source.id}`;
}

function connectorOptions(connectors: GroupRoomResourceConnector[]): ProjectResourceOption[] {
  return connectors.map((connector) => ({
    id: connector.id,
    name: connector.name,
    description: connector.description,
    icon: connector.icon,
    meta: [connector.hasMcp ? "MCP" : "", connector.hasSkills ? "技能" : "", connector.hasCli ? "CLI" : ""]
      .filter(Boolean)
      .join(" · "),
  }));
}

function skillOptions(skills: GroupRoomResourceSkill[]): ProjectResourceOption[] {
  return skills.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description, meta: skill.command }));
}

function inviteableOptions(inviteables: GroupRoomInviteable[]): ProjectResourceOption[] {
  return inviteables.map((item) => ({
    id: item.id,
    name: item.displayName,
    description: item.description,
    icon: item.avatar,
    meta: item.type === "team" ? `专家团 · ${item.members.length} 位成员` : item.category || "专家",
  }));
}

function MemberAvatar({ member }: { member: GroupRoomMember }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold">
      {(member.displayName || "A").slice(0, 1).toUpperCase()}
    </span>
  );
}

type CreateRoomInput = {
  title: string;
  topic: string;
  workspace: string;
  invitationIds: string[];
  customMembers: Array<{ displayName: string; role: string; prompt: string; skillIds: string[] }>;
  connectorGrants: GroupRoomConnectorGrant[];
  settings: { permissionMode: "inherit" | "ask" | "allow-all"; moderatorInstructions: string };
};

function CreateRoomForm({
  resources,
  busy,
  onCancel,
  globalBypassPermissions,
  onCreate,
}: {
  resources: Resources;
  busy: boolean;
  onCancel?: () => void;
  globalBypassPermissions: boolean;
  onCreate: (input: CreateRoomInput) => Promise<void>;
}) {
  const [title, setTitle] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [workspace, setWorkspace] = React.useState("");
  const [invitationIds, setInvitationIds] = React.useState<string[]>([]);
  const [connectorIds, setConnectorIds] = React.useState<string[]>([]);
  const [permissionMode, setPermissionMode] = React.useState<"inherit" | "ask" | "allow-all">("inherit");
  const [moderatorInstructions, setModeratorInstructions] = React.useState(DEFAULT_MODERATOR_INSTRUCTIONS);
  const [customMembers, setCustomMembers] = React.useState<Array<{ id: string; displayName: string; role: string; prompt: string; skillIds: string[] }>>([]);
  const participantCount = resources.inviteables
    .filter((item) => invitationIds.includes(item.id))
    .reduce((total, item) => total + (item.type === "team" ? item.members.length : 1), customMembers.length);
  const valid = Boolean(topic.trim() && workspace.trim() && participantCount >= 1 && participantCount <= 32
    && customMembers.every((member) => member.displayName.trim() && member.prompt.trim()));

  return (
    <div className="absolute inset-0 flex min-h-0 flex-col bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        {onCancel ? <Button size="icon" variant="ghost" onClick={onCancel}><X className="h-4 w-4" /></Button> : null}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">新建群聊</div>
          <div className="text-xs text-muted-foreground">创建配置不会调用模型；首次消息由主持人决定是否激活成员</div>
        </div>
        <Button disabled={!valid || busy} onClick={() => void onCreate({
          title: title.trim(),
          topic: topic.trim(),
          workspace: workspace.trim(),
          invitationIds,
          customMembers: customMembers.map(({ displayName, role, prompt, skillIds }) => ({
            displayName: displayName.trim(), role: role.trim(), prompt: prompt.trim(), skillIds,
          })),
          connectorGrants: resources.connectors.filter((item) => connectorIds.includes(item.id)).map(selectedConnectorGrant),
          settings: { permissionMode, moderatorInstructions: moderatorInstructions.trim() },
        })}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}创建
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-7 px-5 py-6">
          <section className="space-y-3">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="群名称（可选）" />
            <Textarea value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="议题或长期目标" className="min-h-24" />
            <div className="flex gap-2">
              <Input value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="工作区" />
              <Button variant="outline" onClick={async () => { const value = await window.agentDesktop.pickDirectory(); if (value) setWorkspace(value); }}>选择</Button>
            </div>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">权限策略（全局当前：{globalBypassPermissions ? "允许全部" : "按规则确认"}）</span>
              <select className="h-9 w-full rounded-md border border-border bg-background px-2" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as typeof permissionMode)}>
                <option value="inherit">继承全局</option><option value="ask">始终按规则确认</option><option value="allow-all">允许全部</option>
              </select>
            </label>
            <label className="block space-y-1 text-xs">
              <span className="text-muted-foreground">主持人工作方式</span>
              <Textarea value={moderatorInstructions} onChange={(event) => setModeratorInstructions(event.target.value)} maxLength={12_000} className="min-h-28" />
              <span className="text-[10px] text-muted-foreground">这里只描述意图；成员选择、并行和收敛由主持模型判断。</span>
            </label>
          </section>
          <ProjectResourcePicker kind="expert" title="成员" description="选择专家或专家团。" selectedIds={invitationIds} onChange={setInvitationIds} options={inviteableOptions(resources.inviteables)} />
          <section className="space-y-3">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold text-muted-foreground">自定义成员</span><Button size="sm" variant="outline" onClick={() => setCustomMembers((items) => [...items, { id: crypto.randomUUID(), displayName: "", role: "", prompt: "", skillIds: [] }])}><Plus className="h-3.5 w-3.5" />添加</Button></div>
            {customMembers.map((member) => <div key={member.id} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex gap-2"><Input value={member.displayName} placeholder="名称" onChange={(event) => setCustomMembers((items) => items.map((item) => item.id === member.id ? { ...item, displayName: event.target.value } : item))} /><Input value={member.role} placeholder="职责" onChange={(event) => setCustomMembers((items) => items.map((item) => item.id === member.id ? { ...item, role: event.target.value } : item))} /><Button size="icon" variant="ghost" onClick={() => setCustomMembers((items) => items.filter((item) => item.id !== member.id))}><X className="h-4 w-4" /></Button></div>
              <Textarea value={member.prompt} placeholder="成员提示词" onChange={(event) => setCustomMembers((items) => items.map((item) => item.id === member.id ? { ...item, prompt: event.target.value } : item))} />
              <ProjectResourcePicker kind="skill" title="技能" description="该成员可用的技能。" selectedIds={member.skillIds} onChange={(skillIds) => setCustomMembers((items) => items.map((item) => item.id === member.id ? { ...item, skillIds } : item))} options={skillOptions(resources.skills)} />
            </div>)}
          </section>
          <ProjectResourcePicker kind="connector" title="默认成员连接器" description="新成员默认获得的连接器。" selectedIds={connectorIds} onChange={setConnectorIds} options={connectorOptions(resources.connectors)} />
        </div>
      </ScrollArea>
    </div>
  );
}

function MemberResourceDialog({ room, member, resources, busy, onClose, onSave }: {
  room: GroupRoom;
  member: GroupRoomMember;
  resources: Resources;
  busy: boolean;
  onClose: () => void;
  onSave: (connectors: GroupRoomConnectorGrant[], skills: string[]) => Promise<void>;
}) {
  const [connectorIds, setConnectorIds] = React.useState(member.grants.connectors.map((grant) => grant.id));
  const [skills, setSkills] = React.useState(member.grants.skills);
  const availableSkills = resources.skills.filter((skill) => member.resourceSnapshot.skillCommands.includes(skill.command));
  return <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
    <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-xl">
      <header className="flex h-14 items-center gap-3 border-b border-border px-4"><MemberAvatar member={member} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-semibold">{member.displayName}</div><div className="text-xs text-muted-foreground">成员资源边界</div></div><Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button></header>
      <ScrollArea className="min-h-0 flex-1"><div className="space-y-5 p-5"><ProjectResourcePicker kind="connector" title="连接器" description="只允许该成员使用这里授予的连接器。" selectedIds={connectorIds} onChange={setConnectorIds} options={connectorOptions(resources.connectors)} /><ProjectResourcePicker kind="skill" title="技能" description="只显示该专家快照中存在的技能。" selectedIds={skills} onChange={setSkills} options={availableSkills.map((skill) => ({ id: skill.command, name: skill.name, description: skill.description, meta: skill.command }))} /></div></ScrollArea>
      <footer className="flex justify-end gap-2 border-t border-border p-3"><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={busy || room.status === "running"} onClick={() => void onSave(resources.connectors.filter((item) => connectorIds.includes(item.id)).map(selectedConnectorGrant), skills)}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}保存</Button></footer>
    </div>
  </div>;
}

function AddMembersDialog({ room, resources, busy, onClose, onAdd }: {
  room: GroupRoom;
  resources: Resources;
  busy: boolean;
  onClose: () => void;
  onAdd: (members: CreateRoomInput) => Promise<void>;
}) {
  const existingSources = new Set(room.members.filter((member) => member.source.kind !== "custom").map((member) => member.source.id));
  const inviteables = resources.inviteables.filter((item) => item.type === "team"
    ? item.members.some((member) => !room.members.some((current) => current.source.id === item.id && current.source.memberId === member.id))
    : !existingSources.has(item.id));
  const [invitationIds, setInvitationIds] = React.useState<string[]>([]);
  const [customName, setCustomName] = React.useState("");
  const [customRole, setCustomRole] = React.useState("");
  const [customPrompt, setCustomPrompt] = React.useState("");
  const [customSkillIds, setCustomSkillIds] = React.useState<string[]>([]);
  const hasCustom = Boolean(customName.trim() || customPrompt.trim());
  const canAdd = invitationIds.length > 0 || (customName.trim() && customPrompt.trim());
  return <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
    <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-xl">
      <header className="flex h-14 items-center border-b border-border px-4"><div className="min-w-0 flex-1 text-sm font-semibold">添加成员</div><Button size="icon" variant="ghost" onClick={onClose}><X className="h-4 w-4" /></Button></header>
      <ScrollArea className="min-h-0 flex-1"><div className="space-y-5 p-5"><ProjectResourcePicker kind="expert" title="已安装专家" description="专家团会整体加入。" selectedIds={invitationIds} onChange={setInvitationIds} options={inviteableOptions(inviteables)} /><div className="space-y-2 rounded-md border border-border p-3"><div className="text-xs font-semibold">或添加一个自定义成员</div><Input value={customName} onChange={(event) => setCustomName(event.target.value)} placeholder="名称" /><Input value={customRole} onChange={(event) => setCustomRole(event.target.value)} placeholder="职责" /><Textarea value={customPrompt} onChange={(event) => setCustomPrompt(event.target.value)} placeholder="成员提示词" /><ProjectResourcePicker kind="skill" title="技能" description="该自定义成员可用的技能。" selectedIds={customSkillIds} onChange={setCustomSkillIds} options={skillOptions(resources.skills)} /></div></div></ScrollArea>
      <footer className="flex justify-end gap-2 border-t border-border p-3"><Button variant="outline" onClick={onClose}>取消</Button><Button disabled={!canAdd || busy} onClick={() => void onAdd({ title: "", topic: "", workspace: "", invitationIds, customMembers: hasCustom ? [{ displayName: customName.trim(), role: customRole.trim(), prompt: customPrompt.trim(), skillIds: customSkillIds }] : [], connectorGrants: [], settings: { permissionMode: "inherit", moderatorInstructions: "" } })}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}添加</Button></footer>
    </div>
  </div>;
}

function GroupRoomSettings({ room, resources, busy, globalBypassPermissions, onSave, onEditMember, onRefreshMember, onRemoveMember, onAddMember, onToggleRightSidebar }: {
  room: GroupRoom;
  resources: Resources;
  busy: boolean;
  globalBypassPermissions: boolean;
  onSave: (updates: Partial<GroupRoomSummary>) => Promise<void>;
  onEditMember: (id: string) => void;
  onRefreshMember: (id: string) => Promise<void>;
  onRemoveMember: (id: string) => Promise<void>;
  onAddMember: () => void;
  onToggleRightSidebar: () => void;
}) {
  const [title, setTitle] = React.useState(room.title);
  const [topic, setTopic] = React.useState(room.topic);
  const [workspace, setWorkspace] = React.useState(room.workspace);
  const [permissionMode, setPermissionMode] = React.useState(room.settings.permissionMode || "inherit");
  const [moderatorInstructions, setModeratorInstructions] = React.useState(room.settings.moderatorInstructions || DEFAULT_MODERATOR_INSTRUCTIONS);
  React.useEffect(() => {
    setTitle(room.title); setTopic(room.topic); setWorkspace(room.workspace);
    setPermissionMode(room.settings.permissionMode || "inherit");
    setModeratorInstructions(room.settings.moderatorInstructions || DEFAULT_MODERATOR_INSTRUCTIONS);
  }, [room]);
  const disabled = busy || room.status === "running";
  return <aside className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-3">
      <div className="min-w-0 flex-1"><div className="text-sm font-semibold">群设置</div><div className="truncate text-xs text-muted-foreground">固定成员 · Coordinator 主持</div></div>
      <Button size="sm" disabled={disabled} onClick={() => void onSave({ title, topic, workspace, settings: { permissionMode, moderatorInstructions } })}>{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}保存</Button>
      <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={onToggleRightSidebar} title="折叠群设置" aria-label="折叠群设置"><PanelRightClose className="h-4 w-4" /></Button>
    </header>
    <ScrollArea className="min-h-0 flex-1"><div className="space-y-6 p-4">
      {room.status === "running" ? <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-700">主持人正在工作，配置暂时只读。</div> : null}
      <section className="space-y-2"><div className="text-xs font-semibold text-muted-foreground">基本信息</div><Input disabled={disabled} value={title} onChange={(event) => setTitle(event.target.value)} /><Textarea disabled={disabled} value={topic} onChange={(event) => setTopic(event.target.value)} className="min-h-20" /><div className="flex gap-2"><Input disabled={disabled} value={workspace} onChange={(event) => setWorkspace(event.target.value)} /><Button variant="outline" disabled={disabled} onClick={async () => { const value = await window.agentDesktop.pickDirectory(); if (value) setWorkspace(value); }}>选择</Button></div></section>
      <section className="space-y-2"><div className="text-xs font-semibold text-muted-foreground">主持人</div><Textarea disabled={disabled} value={moderatorInstructions} onChange={(event) => setModeratorInstructions(event.target.value)} className="min-h-32" /><select disabled={disabled} className="h-9 w-full rounded-md border border-border bg-background px-2 text-xs" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as typeof permissionMode)}><option value="inherit">继承全局（{globalBypassPermissions ? "允许全部" : "按规则确认"}）</option><option value="ask">按规则确认</option><option value="allow-all">允许全部</option></select></section>
      <section className="space-y-2"><div className="flex items-center justify-between"><div className="text-xs font-semibold text-muted-foreground">成员（{room.members.length}）</div><Button size="sm" variant="outline" disabled={disabled || room.members.length >= 32} onClick={onAddMember}><Plus className="h-3.5 w-3.5" />添加</Button></div>{room.members.map((member) => <div key={member.id} className="rounded-md border border-border p-3"><div className="flex items-start gap-2"><MemberAvatar member={member} /><div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{member.displayName}</div><div className="truncate text-[10px] text-muted-foreground">{memberSourceLabel(member)}</div><div className="line-clamp-2 text-xs text-muted-foreground">{member.role}</div></div><Button size="icon" variant="ghost" disabled={disabled} onClick={() => onEditMember(member.id)} title="资源"><Settings2 className="h-4 w-4" /></Button><Button size="icon" variant="ghost" disabled={disabled || member.source.kind === "custom"} onClick={() => void onRefreshMember(member.id)} title="刷新专家快照"><RefreshCw className="h-4 w-4" /></Button><Button size="icon" variant="ghost" disabled={disabled || room.members.length <= 1} onClick={() => void onRemoveMember(member.id)} title="移除成员"><Trash2 className="h-4 w-4 text-destructive" /></Button></div><div className="mt-2 text-[10px] text-muted-foreground">{member.grants.connectors.length} 个连接器 · {member.grants.skills.length} 个技能</div></div>)}</section>
      <section className="rounded-md border border-border p-3 text-xs text-muted-foreground"><div className="font-medium text-foreground">运行方式</div><p className="mt-1 leading-5">创建和打开房间不会启动成员。主持人根据任务决定自己处理、按需委派或全员 kickoff；没有固定轮数和并行开关。</p></section>
    </div></ScrollArea>
  </aside>;
}

export function GroupRoomsView({
  activeSessionId,
  sessions,
  chatContent,
  activeChildSessionId,
  onOpenChildSession,
  listCollapsed,
  onListCollapsedChange,
  rightCollapsed,
  rightWidth,
  onToggleRightSidebar,
  onResizeRight,
  onOpenSession,
  globalBypassPermissions = false,
}: {
  activeSessionId: string | null;
  sessions: SessionSummary[];
  chatContent: React.ReactNode;
  activeChildSessionId?: string | null;
  onOpenChildSession: (sessionId: string) => void;
  listCollapsed: boolean;
  onListCollapsedChange: (collapsed: boolean) => void;
  rightCollapsed: boolean;
  rightWidth: number;
  onToggleRightSidebar: () => void;
  onResizeRight: (event: React.MouseEvent) => void;
  onOpenSession: (sessionId: string) => Promise<boolean | void>;
  globalBypassPermissions?: boolean;
}) {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [rooms, setRooms] = React.useState<GroupRoomSummary[]>([]);
  const [room, setRoom] = React.useState<GroupRoom | null>(null);
  const [resources, setResources] = React.useState<Resources>({ inviteables: [], connectors: [], skills: [] });
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [menuRoomId, setMenuRoomId] = React.useState<string | null>(null);
  const [resourceMemberId, setResourceMemberId] = React.useState<string | null>(null);
  const [addingMember, setAddingMember] = React.useState(false);
  const [draggedRoomId, setDraggedRoomId] = React.useState<string | null>(null);

  const run = React.useCallback(async <T,>(operation: () => Promise<T>) => {
    setBusy(true); setError("");
    try { return await operation(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); return undefined; }
    finally { setBusy(false); }
  }, []);

  const loadRoom = React.useCallback(async (roomId: string) => {
    const detail = unwrap(await window.agentDesktop.groupRooms.get({ roomId }));
    setRoom(detail);
    return detail;
  }, []);

  const loadRooms = React.useCallback(async () => {
    const list = unwrap(await window.agentDesktop.groupRooms.list());
    setRooms(list);
    return list;
  }, []);

  const selectRoom = React.useCallback(async (entry: GroupRoomSummary) => {
    setCreating(false); setMenuRoomId(null);
    await run(async () => { await loadRoom(entry.id); await onOpenSession(entry.sessionId); });
  }, [loadRoom, onOpenSession, run]);

  React.useEffect(() => {
    let cancelled = false;
    void window.agentDesktop.groupRooms.status().then(async (result) => {
      const status = unwrap(result); if (cancelled) return; setEnabled(status.enabled); if (!status.enabled) return;
      const [list, available] = await Promise.all([loadRooms(), window.agentDesktop.groupRooms.listResources().then(unwrap)]);
      if (cancelled) return; setResources(available);
      const selected = list.find((entry) => entry.sessionId === activeSessionId) || list[0];
      if (selected) { await loadRoom(selected.id); if (selected.sessionId !== activeSessionId) await onOpenSession(selected.sessionId); }
      else setCreating(true);
    }).catch((cause) => { if (!cancelled) { setEnabled(false); setError(cause instanceof Error ? cause.message : String(cause)); } });
    const off = window.agentDesktop.groupRooms.onEvent((event) => {
      void loadRooms();
    });
    return () => { cancelled = true; off(); };
  }, []);

  React.useEffect(() => {
    const match = rooms.find((entry) => entry.sessionId === activeSessionId);
    if (match && match.id !== room?.id) void loadRoom(match.id);
  }, [activeSessionId, loadRoom, room?.id, rooms]);

  const activeWorkerParents = new Set(sessions
    .filter((entry) => entry.isSubAgent && entry.parentSessionId && entry.subagentStatus === "running")
    .map((entry) => entry.parentSessionId));
  const liveRooms = rooms.map((entry) => {
    const session = sessions.find((item) => item.id === entry.sessionId);
    return session ? { ...entry, status: session.busy || activeWorkerParents.has(session.id) ? "running" as const : "idle" as const, preview: session.preview, messageCount: session.messageCount, updatedAt: session.updatedAt } : entry;
  });
  const activeSession = sessions.find((entry) => entry.id === room?.sessionId);
  const liveRoom = room && activeSession ? { ...room, status: activeSession.busy || activeWorkerParents.has(activeSession.id) ? "running" as const : "idle" as const, preview: activeSession.preview, messageCount: activeSession.messageCount, updatedAt: activeSession.updatedAt } : room;
  const childSessionsByParent = new Map<string, SessionSummary[]>();
  for (const session of sessions) {
    if (!session.isSubAgent || !session.parentSessionId) continue;
    const children = childSessionsByParent.get(session.parentSessionId) || [];
    children.push(session);
    childSessionsByParent.set(session.parentSessionId, children);
  }

  const reorder = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const ids = liveRooms.map((entry) => entry.id);
    const from = ids.indexOf(sourceId); const to = ids.indexOf(targetId);
    if (from < 0 || to < 0) return;
    const next = [...ids]; next.splice(to, 0, next.splice(from, 1)[0]);
    setRooms(next.map((id, order) => ({ ...liveRooms.find((entry) => entry.id === id)!, order })));
    await run(async () => setRooms(unwrap(await window.agentDesktop.groupRooms.reorder({ roomIds: next }))));
  };

  const moveRoom = (id: string, delta: number) => {
    const index = liveRooms.findIndex((entry) => entry.id === id);
    const target = liveRooms[index + delta];
    if (target) void reorder(id, target.id);
  };

  if (enabled === null) return <div className="flex h-full items-center justify-center text-sm text-muted-foreground"><LoaderCircle className="mr-2 h-4 w-4 animate-spin" />加载群聊…</div>;
  if (!enabled) return <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">群聊功能未启用。请在高级设置中开启。</div>;
  if (creating) return <CreateRoomForm resources={resources} busy={busy} globalBypassPermissions={globalBypassPermissions} onCancel={rooms.length ? () => setCreating(false) : undefined} onCreate={async (input) => { await run(async () => { const created = unwrap(await window.agentDesktop.groupRooms.create(input)); setRoom(created); setCreating(false); await loadRooms(); await onOpenSession(created.sessionId); }); }} />;

  return <div className="absolute inset-0 flex min-h-0 min-w-0 overflow-hidden bg-background">
    {!listCollapsed ? <aside className="hidden h-full w-60 shrink-0 flex-col border-r border-border lg:flex">
      <header className="flex h-14 items-center gap-1 border-b border-border px-2"><span className="min-w-0 flex-1 px-1 text-sm font-semibold">群聊</span><Button size="icon" variant="ghost" onClick={() => setCreating(true)} title="新建群聊"><Plus className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => void run(loadRooms)} title="刷新"><RefreshCw className="h-4 w-4" /></Button><Button size="icon" variant="ghost" onClick={() => onListCollapsedChange(true)} title="折叠群列表" aria-label="折叠群列表"><PanelLeftClose className="h-4 w-4" /></Button></header>
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto"><div className="w-full min-w-0 space-y-1 overflow-hidden p-2">{liveRooms.map((entry, index) => {
        const children = childSessionsByParent.get(entry.sessionId) || [];
        return <div key={entry.id} draggable onDragStart={() => setDraggedRoomId(entry.id)} onDragEnd={() => setDraggedRoomId(null)} onDragOver={(event) => event.preventDefault()} onDrop={() => { if (draggedRoomId) void reorder(draggedRoomId, entry.id); }} className={cn("group relative rounded-md", draggedRoomId === entry.id && "opacity-50")}>
          <div className={cn("flex h-12 items-center rounded-md", liveRoom?.id === entry.id ? "bg-primary/10" : "hover:bg-muted")}><GripVertical className="ml-1 h-4 w-4 cursor-grab text-muted-foreground/60" /><button className="flex h-full min-w-0 flex-1 items-center gap-2 px-2 text-left" onClick={() => void selectRoom(entry)}><span className={cn("h-2 w-2 rounded-full", entry.status === "running" ? "bg-emerald-500" : "bg-muted-foreground/40")} /><span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{entry.title}</span><span className="block truncate text-[10px] text-muted-foreground">{entry.preview || formatTime(entry.updatedAt)}</span></span>{children.length ? <span className="flex h-5 shrink-0 items-center gap-1 rounded-md bg-muted px-1.5 text-[10px] tabular-nums text-muted-foreground" title={`${children.length} 个子会话`}><Bot className="h-3 w-3" />{children.length}</span> : null}</button><Button size="icon" variant="ghost" className="mr-1 h-7 w-7 opacity-0 group-hover:opacity-100" onClick={() => setMenuRoomId(menuRoomId === entry.id ? null : entry.id)}><MoreHorizontal className="h-4 w-4" /></Button></div>
          {children.map((child, childIndex) => <SessionTreeChildItem key={child.id} title={child.title} busy={child.busy} status={child.subagentStatus} isActive={activeChildSessionId === child.id} isLastChild={childIndex === children.length - 1} onClick={() => { void (async () => { if (activeSessionId !== entry.sessionId) await selectRoom(entry); onOpenChildSession(child.id); })(); }} />)}
          {menuRoomId === entry.id ? <div className="absolute right-1 top-10 z-20 w-36 rounded-md border border-border bg-popover p-1 shadow-lg"><button className="flex w-full items-center rounded px-2 py-1.5 text-left text-xs hover:bg-muted" onClick={() => { const title = window.prompt("新的群名称", entry.title)?.trim(); setMenuRoomId(null); if (title) void run(async () => { const detail = unwrap(await window.agentDesktop.groupRooms.get({ roomId: entry.id })); const updated = unwrap(await window.agentDesktop.groupRooms.update({ roomId: entry.id, updates: { title }, expectedRevision: detail.revision })); if (liveRoom?.id === entry.id) setRoom(updated); await loadRooms(); }); }}>重命名</button><button disabled={index === 0} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-40" onClick={() => moveRoom(entry.id, -1)}><ChevronUp className="h-3.5 w-3.5" />上移</button><button disabled={index === liveRooms.length - 1} className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-muted disabled:opacity-40" onClick={() => moveRoom(entry.id, 1)}><ChevronDown className="h-3.5 w-3.5" />下移</button><button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-xs text-destructive hover:bg-muted" onClick={() => { setMenuRoomId(null); if (!window.confirm(`删除群聊“${entry.title}”及其完整会话记录？`)) return; void run(async () => { unwrap(await window.agentDesktop.groupRooms.delete({ roomId: entry.id })); const next = await loadRooms(); if (liveRoom?.id === entry.id) { setRoom(null); if (next[0]) { await loadRoom(next[0].id); await onOpenSession(next[0].sessionId); } else setCreating(true); } }); }}><Trash2 className="h-3.5 w-3.5" />删除</button></div> : null}
        </div>;
      })}</div></div>
    </aside> : null}

    <main className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">{error ? <div className="absolute left-4 right-4 top-3 z-40 rounded-md border border-destructive/30 bg-background px-3 py-2 text-xs text-destructive shadow">{error}</div> : null}{liveRoom && activeSessionId === liveRoom.sessionId ? chatContent : <div className="flex h-full w-full items-center justify-center text-sm text-muted-foreground">{liveRooms.length ? "选择一个群聊" : "创建第一个群聊"}</div>}</main>

    {liveRoom && !rightCollapsed ? <><div className="relative hidden w-3 shrink-0 cursor-col-resize before:absolute before:inset-y-4 before:left-1/2 before:w-px before:bg-border lg:block" onMouseDown={onResizeRight} /><div className="min-h-0 shrink-0 overflow-hidden border-l border-border" style={{ width: `min(${rightWidth}px, 42vw)` }}><GroupRoomSettings room={liveRoom} resources={resources} busy={busy} globalBypassPermissions={globalBypassPermissions} onToggleRightSidebar={onToggleRightSidebar} onAddMember={() => setAddingMember(true)} onEditMember={setResourceMemberId} onRefreshMember={async (memberId) => { await run(async () => { const updated = unwrap(await window.agentDesktop.groupRooms.refreshMemberSource({ roomId: liveRoom.id, memberId, expectedRevision: liveRoom.revision })); setRoom(updated); await loadRooms(); }); }} onRemoveMember={async (memberId) => { const member = liveRoom.members.find((item) => item.id === memberId); if (!member || !window.confirm(`从群聊移除“${member.displayName}”？`)) return; await run(async () => { const updated = unwrap(await window.agentDesktop.groupRooms.removeMember({ roomId: liveRoom.id, memberId, expectedRevision: liveRoom.revision })); setRoom(updated); await loadRooms(); }); }} onSave={async (updates) => { await run(async () => { const updated = unwrap(await window.agentDesktop.groupRooms.update({ roomId: liveRoom.id, updates, expectedRevision: liveRoom.revision })); setRoom(updated); await loadRooms(); }); }} /></div></> : null}

    {liveRoom && resourceMemberId ? (() => { const member = liveRoom.members.find((item) => item.id === resourceMemberId); return member ? <MemberResourceDialog room={liveRoom} member={member} resources={resources} busy={busy} onClose={() => setResourceMemberId(null)} onSave={async (connectors, skills) => { await run(async () => { const updated = unwrap(await window.agentDesktop.groupRooms.updateMemberGrants({ roomId: liveRoom.id, memberId: member.id, grants: { connectors, skills }, expectedRevision: liveRoom.revision })); setRoom(updated); setResourceMemberId(null); await loadRooms(); }); }} /> : null; })() : null}
    {liveRoom && addingMember ? <AddMembersDialog room={liveRoom} resources={resources} busy={busy} onClose={() => setAddingMember(false)} onAdd={async (input) => { await run(async () => { const updated = unwrap(await window.agentDesktop.groupRooms.addMembers({ roomId: liveRoom.id, members: { invitationIds: input.invitationIds, customMembers: input.customMembers, connectorGrants: input.connectorGrants }, expectedRevision: liveRoom.revision })); setRoom(updated); setAddingMember(false); await loadRooms(); }); }} /> : null}
  </div>;
}
