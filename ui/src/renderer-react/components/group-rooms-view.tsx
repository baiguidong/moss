"use client";

import * as React from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  CircleStop,
  Cable,
  LoaderCircle,
  MessageSquarePlus,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Send,
  Settings2,
  Trash2,
  TriangleAlert,
  User,
  UsersRound,
  X,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MessageListPane } from "@/components/chat/message-list";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import {
  ProjectResourcePicker,
  type ProjectResourceOption,
} from "@/components/projects/project-resource-picker";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { buildGroupRoomMemberTranscript } from "@/lib/group-room-transcript";
import { cn } from "@/lib/utils";
import type {
  DesktopSettings,
  GroupRoom,
  GroupRoomConnectorGrant,
  GroupRoomInviteable,
  GroupRoomMember,
  GroupRoomPermissionRequest,
  GroupRoomResourceConnector,
  GroupRoomResourceSkill,
  GroupRoomSummary,
  GroupRoomTraceEvent,
  GroupRoomTurn,
} from "../types";

function unwrap<T>(result: { success: boolean; data?: T; error?: string }): T {
  if (!result?.success || result.data === undefined) {
    throw new Error(result?.error || "群聊操作失败");
  }
  return result.data;
}

function statusLabel(status: string) {
  if (status === "running") return "执行中";
  if (status === "paused") return "已暂停";
  if (status === "failed") return "失败";
  if (status === "interrupted") return "已中止";
  if (status === "completed") return "已完成";
  if (status === "pending") return "等待中";
  return "空闲";
}

function statusDot(status: string) {
  if (status === "running") return "bg-emerald-500";
  if (status === "paused" || status === "pending") return "bg-amber-500";
  if (status === "failed" || status === "interrupted") return "bg-destructive";
  return "bg-muted-foreground/45";
}

function friendlyRunError(value: string) {
  const message = String(value || "");
  if (message === "Interrupted by the room host") return "已由用户中断";
  if (message === "Interrupted by the user") return "已由用户中断";
  if (message === "Stopped by the room host") return "已由用户停止";
  if (message === "Stopped by the user") return "已由用户停止";
  if (message === "Superseded by a host intervention") return "已被用户的新补充取代";
  if (message === "Room token budget reached") return "已达到房间 token 预算";
  return message;
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function traceText(event: GroupRoomTraceEvent) {
  const value = event.type === "tool_call" ? event.input : event.content;
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value || ""); }
}

function activeTurnForMember(room: GroupRoom, memberId: string) {
  const turns = room.activeRun?.turns.filter((turn) => turn.memberId === memberId) || [];
  return turns.find((turn) => turn.status === "running")
    || turns.find((turn) => turn.status === "pending")
    || [...turns].reverse()[0]
    || null;
}

function selectedConnectorGrant(connector: GroupRoomResourceConnector): GroupRoomConnectorGrant {
  const canMutate = connector.hasCli || connector.hasMcp || connector.hasSkills;
  return {
    id: connector.id,
    access: canMutate ? "write" : "read",
    exec: connector.hasCli || undefined,
  };
}

function connectorOptions(connectors: GroupRoomResourceConnector[]): ProjectResourceOption[] {
  return connectors.map((connector) => ({
    id: connector.id,
    name: connector.name,
    description: connector.description,
    icon: connector.icon,
    meta: connectorCapabilities(connector),
  }));
}

function skillOptions(skills: GroupRoomResourceSkill[]): ProjectResourceOption[] {
  return skills.map((skill) => ({
    id: skill.id,
    name: skill.name,
    description: skill.description,
    meta: skill.command,
  }));
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

function connectorCapabilities(connector: GroupRoomResourceConnector) {
  return [connector.hasMcp ? "MCP" : "", connector.hasSkills ? "技能" : "", connector.hasCli ? "CLI" : ""]
    .filter(Boolean)
    .join(" · ");
}

function MemberAvatar({ member }: { member: GroupRoomMember }) {
  return (
    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-background text-xs font-semibold text-foreground">
      {(member.displayName || "A").slice(0, 1).toUpperCase()}
    </span>
  );
}

function HumanAvatar() {
  return (
    <Avatar data-group-room-human-avatar className="h-7 w-7 shrink-0">
      <AvatarFallback className="bg-muted text-muted-foreground">
        <User className="h-4 w-4" />
      </AvatarFallback>
    </Avatar>
  );
}

function ModeratorAvatar() {
  return (
    <Avatar data-group-room-moderator-avatar className="h-7 w-7 shrink-0">
      <AvatarFallback className="bg-primary/10 text-primary">
        <Bot className="h-4 w-4" />
      </AvatarFallback>
    </Avatar>
  );
}

type CreateRoomFormProps = {
  resources: { inviteables: GroupRoomInviteable[]; connectors: GroupRoomResourceConnector[]; skills: GroupRoomResourceSkill[] };
  busy: boolean;
  onCancel?: () => void;
  globalBypassPermissions: boolean;
  onCreate: (input: {
    title: string;
    topic: string;
    workspace: string;
    invitationIds: string[];
    customMembers: Array<{ displayName: string; role: string; prompt: string; skillIds: string[] }>;
    connectorGrants: GroupRoomConnectorGrant[];
    settings: {
      permissionMode: "inherit" | "ask" | "allow-all";
      maxAgentTurns: number;
      maxModeratorSteps: number;
      turnTimeoutMs: number;
      runTimeoutMs: number;
      tokenBudget: number;
      summaryThresholdChars: number;
    };
  }) => Promise<void>;
};

function CreateRoomForm({ resources, busy, onCancel, globalBypassPermissions, onCreate }: CreateRoomFormProps) {
  const [title, setTitle] = React.useState("");
  const [topic, setTopic] = React.useState("");
  const [workspace, setWorkspace] = React.useState("");
  const [invitationIds, setInvitationIds] = React.useState<string[]>([]);
  const [connectorIds, setConnectorIds] = React.useState<string[]>([]);
  const [permissionMode, setPermissionMode] = React.useState<"inherit" | "ask" | "allow-all">("inherit");
  const [maxAgentTurns, setMaxAgentTurns] = React.useState("12");
  const [maxModeratorSteps, setMaxModeratorSteps] = React.useState("16");
  const [turnTimeoutMinutes, setTurnTimeoutMinutes] = React.useState("15");
  const [runTimeoutMinutes, setRunTimeoutMinutes] = React.useState("45");
  const [tokenBudget, setTokenBudget] = React.useState("");
  const [summaryThresholdChars, setSummaryThresholdChars] = React.useState("120000");
  const [customMembers, setCustomMembers] = React.useState<Array<{ id: string; displayName: string; role: string; prompt: string; skillIds: string[] }>>([]);
  const expertPickerOptions = React.useMemo(() => inviteableOptions(resources.inviteables), [resources.inviteables]);
  const connectorPickerOptions = React.useMemo(() => connectorOptions(resources.connectors), [resources.connectors]);
  const installedSkillOptions = React.useMemo(() => skillOptions(resources.skills), [resources.skills]);

  const pickWorkspace = async () => {
    const selected = await window.agentDesktop.pickDirectory();
    if (selected) setWorkspace(selected);
  };
  const addCustomMember = () => setCustomMembers((current) => [...current, {
    id: crypto.randomUUID(),
    displayName: "",
    role: "",
    prompt: "",
    skillIds: [],
  }]);
  const updateCustomMember = (id: string, updates: Partial<(typeof customMembers)[number]>) => {
    setCustomMembers((current) => current.map((member) => member.id === id ? { ...member, ...updates } : member));
  };
  const participantCount = resources.inviteables
    .filter((item) => invitationIds.includes(item.id))
    .reduce((total, item) => total + (item.type === "team" ? item.members.length : 1), customMembers.length);
  const customMembersValid = customMembers.every((member) => member.displayName.trim() && member.prompt.trim());
  const parsedTokenBudget = Number(tokenBudget);
  const tokenBudgetValid = !tokenBudget.trim()
    || (Number.isInteger(parsedTokenBudget) && parsedTokenBudget >= 1_000 && parsedTokenBudget <= 2_000_000);
  const parsedMaxAgentTurns = Number(maxAgentTurns);
  const parsedMaxModeratorSteps = Number(maxModeratorSteps);
  const parsedTurnTimeoutMinutes = Number(turnTimeoutMinutes);
  const parsedRunTimeoutMinutes = Number(runTimeoutMinutes);
  const parsedSummaryThresholdChars = Number(summaryThresholdChars);
  const runtimeLimitsValid = (
    Number.isInteger(parsedMaxAgentTurns) && parsedMaxAgentTurns >= 1 && parsedMaxAgentTurns <= 50
    && Number.isInteger(parsedMaxModeratorSteps) && parsedMaxModeratorSteps >= 2 && parsedMaxModeratorSteps <= 64
    && Number.isFinite(parsedTurnTimeoutMinutes) && parsedTurnTimeoutMinutes >= 0.5 && parsedTurnTimeoutMinutes <= 30
    && Number.isFinite(parsedRunTimeoutMinutes) && parsedRunTimeoutMinutes >= 1 && parsedRunTimeoutMinutes <= 90
    && Number.isInteger(parsedSummaryThresholdChars) && parsedSummaryThresholdChars >= 40_000 && parsedSummaryThresholdChars <= 1_000_000
  );
  const canCreate = Boolean(topic.trim() && workspace.trim() && participantCount >= 1 && participantCount <= 32 && customMembersValid && tokenBudgetValid && runtimeLimitsValid && !busy);
  return (
    <div className="absolute inset-0 flex min-h-0 min-w-0 flex-col overflow-hidden bg-background">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4 sm:px-6">
        {onCancel ? <Button size="icon" variant="ghost" onClick={onCancel} title="关闭"><X className="h-4 w-4" /></Button> : null}
        <div className="min-w-0 flex-1">
          <h1 className="text-sm font-semibold">新建群聊</h1>
          <p className="text-xs text-muted-foreground">主持人 · {participantCount} 位专家</p>
        </div>
        <Button
          size="sm"
          disabled={!canCreate}
          onClick={() => onCreate({
            title: title.trim(),
            topic: topic.trim(),
            workspace: workspace.trim(),
            invitationIds,
            customMembers: customMembers.map((member) => ({
              displayName: member.displayName.trim(),
              role: member.role.trim(),
              prompt: member.prompt.trim(),
              skillIds: member.skillIds,
            })),
            connectorGrants: resources.connectors
              .filter((connector) => connectorIds.includes(connector.id))
              .map(selectedConnectorGrant),
            settings: {
              permissionMode,
              maxAgentTurns: parsedMaxAgentTurns,
              maxModeratorSteps: parsedMaxModeratorSteps,
              turnTimeoutMs: parsedTurnTimeoutMinutes * 60_000,
              runTimeoutMs: parsedRunTimeoutMinutes * 60_000,
              tokenBudget: tokenBudget.trim() ? parsedTokenBudget : 0,
              summaryThresholdChars: parsedSummaryThresholdChars,
            },
          })}
        >
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          创建
        </Button>
      </header>
      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-4xl space-y-7 px-4 py-6 sm:px-8">
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground">议题</h2>
            <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="房间名称（可选）" />
            <Textarea value={topic} onChange={(event) => setTopic(event.target.value)} placeholder="输入讨论议题" className="min-h-24 resize-y" />
            <div className="flex gap-2">
              <Input value={workspace} onChange={(event) => setWorkspace(event.target.value)} placeholder="输入或选择工作区" className="min-w-0 flex-1" />
              <Button variant="outline" onClick={pickWorkspace}>选择</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2 border-y border-border py-2">
              <span className="min-w-0 flex-1 text-xs text-muted-foreground">群权限优先 · 全局当前{globalBypassPermissions ? "允许全部" : "按规则确认"}</span>
              <select aria-label="群权限" className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none" value={permissionMode} onChange={(event) => setPermissionMode(event.target.value as typeof permissionMode)}>
                <option value="inherit">继承全局</option>
                <option value="ask">群内确认</option>
                <option value="allow-all">群内允许</option>
              </select>
            </div>
            <div className="space-y-3 rounded-md border border-border p-3">
              <div>
                <h3 className="text-xs font-semibold">运行边界</h3>
                <p className="mt-1 text-[11px] text-muted-foreground">这些参数只负责资源和故障保护；由主持人自行决定委派对象、并行方式和何时收敛。</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">单成员最大模型轮次</span>
                  <Input aria-label="单成员最大模型轮次" type="number" min={1} max={50} step={1} value={maxAgentTurns} onChange={(event) => setMaxAgentTurns(event.target.value)} className="h-8 text-xs" />
                  <span className="block text-[10px] text-muted-foreground">默认 12，范围 1–50</span>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">主持决策步数上限</span>
                  <Input aria-label="主持决策步数上限" type="number" min={2} max={64} step={1} value={maxModeratorSteps} onChange={(event) => setMaxModeratorSteps(event.target.value)} className="h-8 text-xs" />
                  <span className="block text-[10px] text-muted-foreground">默认 16，范围 2–64</span>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">成员任务超时（分钟）</span>
                  <Input aria-label="成员任务超时（分钟）" type="number" min={0.5} max={30} step={0.5} value={turnTimeoutMinutes} onChange={(event) => setTurnTimeoutMinutes(event.target.value)} className="h-8 text-xs" />
                  <span className="block text-[10px] text-muted-foreground">默认 15，范围 0.5–30</span>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">单次请求超时（分钟）</span>
                  <Input aria-label="单次请求超时（分钟）" type="number" min={1} max={90} step={1} value={runTimeoutMinutes} onChange={(event) => setRunTimeoutMinutes(event.target.value)} className="h-8 text-xs" />
                  <span className="block text-[10px] text-muted-foreground">默认 45，范围 1–90</span>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">上下文摘要阈值（字符）</span>
                  <Input aria-label="上下文摘要阈值（字符）" type="number" min={40_000} max={1_000_000} step={10_000} value={summaryThresholdChars} onChange={(event) => setSummaryThresholdChars(event.target.value)} className="h-8 text-xs" />
                  <span className="block text-[10px] text-muted-foreground">默认 120,000，范围 40,000–1,000,000</span>
                </label>
                <label className="space-y-1 text-xs">
                  <span className="text-muted-foreground">单次请求 Token 上限</span>
                  <Input aria-label="单次请求 Token 上限" type="number" min={1_000} max={2_000_000} step={10_000} value={tokenBudget} onChange={(event) => setTokenBudget(event.target.value)} placeholder="不限制" className="h-8 text-xs" />
                  <span className={cn("block text-[10px]", tokenBudgetValid ? "text-muted-foreground" : "text-destructive")}>{tokenBudgetValid ? "默认不限制；可设 1,000–2,000,000" : "请输入 1,000–2,000,000，或留空"}</span>
                </label>
              </div>
              {!runtimeLimitsValid ? <p className="text-xs text-destructive">运行边界参数超出允许范围，请按字段提示修正。</p> : null}
            </div>
          </section>

          <section className="space-y-3">
            <ProjectResourcePicker
              kind="expert"
              title="添加专家或专家团"
              description="选择已安装的专家；专家团会展开为房间成员。"
              selectedIds={invitationIds}
              onChange={setInvitationIds}
              options={expertPickerOptions}
            />
            <div className="flex items-center gap-2 pt-2">
              <span className="min-w-0 flex-1 text-xs font-semibold text-muted-foreground">自定义成员</span>
              <Button size="sm" variant="outline" className="h-7" onClick={addCustomMember} disabled={participantCount >= 32}>
                <Plus className="h-3.5 w-3.5" />添加
              </Button>
            </div>
            {customMembers.map((member, index) => (
              <div key={member.id} className="space-y-2 rounded-md border border-border p-3">
                <div className="grid grid-cols-[2rem_minmax(0,1fr)_2rem] items-center gap-2 sm:grid-cols-[2rem_minmax(0,1fr)_minmax(0,1fr)_2rem]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border"><Bot className="h-4 w-4" /></span>
                  <Input value={member.displayName} onChange={(event) => updateCustomMember(member.id, { displayName: event.target.value })} placeholder={`成员 ${index + 1} 名称`} className="h-8 min-w-0" />
                  <Input value={member.role} onChange={(event) => updateCustomMember(member.id, { role: event.target.value })} placeholder="角色（可选）" className="col-start-2 h-8 min-w-0 sm:col-auto" />
                  <Button size="icon" variant="ghost" className="col-start-3 row-start-1 h-8 w-8 shrink-0 sm:col-auto sm:row-auto" onClick={() => setCustomMembers((current) => current.filter((entry) => entry.id !== member.id))} title="移除自定义成员"><X className="h-4 w-4" /></Button>
                </div>
                <Textarea value={member.prompt} onChange={(event) => updateCustomMember(member.id, { prompt: event.target.value })} placeholder="输入该成员的职责、判断标准和输出要求" className="min-h-20 resize-y text-sm" />
                <ProjectResourcePicker
                  kind="skill"
                  title="成员技能"
                  description="选择这个自定义成员可调用的技能。"
                  selectedIds={member.skillIds}
                  onChange={(skillIds) => updateCustomMember(member.id, { skillIds })}
                  options={installedSkillOptions}
                />
              </div>
            ))}
            {participantCount > 32 ? <p className="text-xs text-destructive">房间最多 32 位成员，请减少专家或自定义成员。</p> : null}
          </section>

          <ProjectResourcePicker
            kind="connector"
            title="添加个人授权连接器"
            description="选择房间成员可使用的连接器；具体工具操作仍按群权限确认。"
            selectedIds={connectorIds}
            onChange={setConnectorIds}
            options={connectorPickerOptions}
          />
        </div>
      </ScrollArea>
    </div>
  );
}

function MemberResourceDialog({
  room,
  member,
  connectors,
  skills,
  busy,
  onClose,
  onSave,
}: {
  room: GroupRoom;
  member: GroupRoomMember;
  connectors: GroupRoomResourceConnector[];
  skills: GroupRoomResourceSkill[];
  busy: boolean;
  onClose: () => void;
  onSave: (connectorGrants: GroupRoomConnectorGrant[], skillCommands: string[]) => Promise<void>;
}) {
  const [connectorIds, setConnectorIds] = React.useState(member.grants.connectors.map((grant) => grant.id));
  const [skillCommands, setSkillCommands] = React.useState(member.grants.skills);
  const connectorPickerOptions = React.useMemo(() => connectorOptions(connectors), [connectors]);
  const skillPickerOptions = React.useMemo(() => skills
    .filter((skill) => member.resourceSnapshot.skillCommands.includes(skill.command))
    .map((skill) => ({
      id: skill.command,
      name: skill.name,
      description: skill.description,
      meta: skill.command,
    })), [member.resourceSnapshot.skillCommands, skills]);

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
      <div className="flex max-h-[min(760px,90vh)] w-full max-w-2xl flex-col overflow-hidden rounded-md border border-border bg-background shadow-xl">
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-4">
          <MemberAvatar member={member} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold">{member.displayName}</div>
            <div className="truncate text-xs text-muted-foreground">成员资源</div>
          </div>
          <Button size="icon" variant="ghost" onClick={onClose} title="关闭"><X className="h-4 w-4" /></Button>
        </header>
        <ScrollArea className="min-h-0 flex-1">
          <div className="px-5 py-4">
            <ProjectResourcePicker
              kind="connector"
              title="添加个人授权连接器"
              description="选择该成员可使用的连接器；具体工具操作仍按群权限确认。"
              selectedIds={connectorIds}
              onChange={setConnectorIds}
              options={connectorPickerOptions}
            />
            <ProjectResourcePicker
              kind="skill"
              title="添加技能"
              description="选择该成员快照中可用的技能。"
              selectedIds={skillCommands}
              onChange={setSkillCommands}
              options={skillPickerOptions}
            />
          </div>
        </ScrollArea>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button
            disabled={busy || room.status === "running"}
            onClick={() => void onSave(
              connectors.filter((connector) => connectorIds.includes(connector.id)).map(selectedConnectorGrant),
              skillCommands,
            )}
          >
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            保存
          </Button>
        </footer>
      </div>
    </div>
  );
}

export function GroupRoomsView({
  onOpenConnectorHub,
  globalBypassPermissions = false,
}: {
  onOpenConnectorHub?: () => void;
  globalBypassPermissions?: boolean;
}) {
  const [enabled, setEnabled] = React.useState<boolean | null>(null);
  const [rooms, setRooms] = React.useState<GroupRoomSummary[]>([]);
  const [room, setRoom] = React.useState<GroupRoom | null>(null);
  const [resources, setResources] = React.useState<{ inviteables: GroupRoomInviteable[]; connectors: GroupRoomResourceConnector[]; skills: GroupRoomResourceSkill[] }>({ inviteables: [], connectors: [], skills: [] });
  const [creating, setCreating] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const [composer, setComposer] = React.useState("");
  const [selectedMemberId, setSelectedMemberId] = React.useState<string | null>(null);
  const [expandedRoomIds, setExpandedRoomIds] = React.useState<Set<string>>(new Set());
  const [roomListCollapsed, setRoomListCollapsed] = React.useState(false);
  const [resourceMemberId, setResourceMemberId] = React.useState<string | null>(null);
  const [streams, setStreams] = React.useState<Record<string, string>>({});
  const [liveTraces, setLiveTraces] = React.useState<Record<string, GroupRoomTraceEvent[]>>({});
  const [permissions, setPermissions] = React.useState<GroupRoomPermissionRequest[]>([]);
  const revisionsRef = React.useRef<Map<string, number>>(new Map());
  const streamOffsetsRef = React.useRef<Map<string, number>>(new Map());
  const traceOffsetsRef = React.useRef<Map<string, number>>(new Map());

  const refreshRooms = React.useCallback(async (preferredId?: string) => {
    const list = unwrap(await window.agentDesktop.groupRooms.list());
    setRooms(list);
    const requestedId = preferredId || room?.id;
    const roomId = requestedId && list.some((entry) => entry.id === requestedId)
      ? requestedId
      : list[0]?.id;
    if (!roomId) {
      setRoom(null);
      setCreating(true);
      return;
    }
    const detail = unwrap(await window.agentDesktop.groupRooms.get({ roomId }));
    setRoom(detail);
    setSelectedMemberId((current) => current && detail.members.some((member) => member.id === current) ? current : null);
    setExpandedRoomIds((current) => new Set(current).add(detail.id));
  }, [room?.id]);

  const refreshResources = React.useCallback(async () => {
    setResources(unwrap(await window.agentDesktop.groupRooms.listResources()));
  }, []);

  const refreshPermissions = React.useCallback(async () => {
    setPermissions(unwrap(await window.agentDesktop.groupRooms.listPendingPermissions()));
  }, []);

  React.useEffect(() => {
    let mounted = true;
    void window.agentDesktop.groupRooms.status().then((result) => {
      if (!mounted) return;
      const nextEnabled = Boolean(result.data?.enabled);
      setEnabled(nextEnabled);
      if (nextEnabled) return Promise.all([refreshRooms(), refreshResources(), refreshPermissions()]);
    }).catch((reason) => setError(String(reason)));
    return () => { mounted = false; };
  }, [refreshPermissions, refreshResources, refreshRooms]);

  React.useEffect(() => {
    const offEvent = window.agentDesktop.groupRooms.onEvent((event) => {
      if (event.type === "room-deleted") {
        void refreshRooms();
        return;
      }
      const previousRevision = revisionsRef.current.get(event.roomId) || 0;
      if (event.revision && event.revision < previousRevision) return;
      if (previousRevision > 0 && event.revision > previousRevision + 1) void refreshRooms(event.roomId);
      if (event.revision) revisionsRef.current.set(event.roomId, event.revision);
      if (event.type === "run-finished") {
        const finishedTurnIds = new Set(
          (event.payload?.recentRuns || []).flatMap((run: GroupRoom["recentRuns"][number]) => run.turns.map((turn) => turn.id)),
        );
        setStreams((current) => Object.fromEntries(
          Object.entries(current).filter(([turnId]) => !finishedTurnIds.has(turnId)),
        ));
        setLiveTraces((current) => Object.fromEntries(
          Object.entries(current).filter(([turnId]) => !finishedTurnIds.has(turnId)),
        ));
        for (const key of [...streamOffsetsRef.current.keys()]) {
          if (key.startsWith(`${event.roomId}:`)) streamOffsetsRef.current.delete(key);
        }
        for (const key of [...traceOffsetsRef.current.keys()]) {
          if (key.startsWith(`${event.roomId}:`)) traceOffsetsRef.current.delete(key);
        }
      }
      setRooms((current) => {
        const summary = event.payload;
        return [summary, ...current.filter((entry) => entry.id !== summary.id)].sort((a, b) => b.updatedAt - a.updatedAt);
      });
      setRoom((current) => current?.id === event.roomId ? event.payload : current);
    });
    const offStream = window.agentDesktop.groupRooms.onStream((event) => {
      if (event.type === "trace" && event.event) {
        const offsetKey = `${event.roomId}:${event.turnId}`;
        const previousOffset = traceOffsetsRef.current.get(offsetKey) || 0;
        const nextOffset = Number(event.traceOffset) || previousOffset + 1;
        if (nextOffset <= previousOffset) return;
        if (nextOffset > previousOffset + 1 && room?.id === event.roomId) void refreshRooms(event.roomId);
        traceOffsetsRef.current.set(offsetKey, nextOffset);
        setLiveTraces((current) => ({ ...current, [event.turnId]: [...(current[event.turnId] || []), event.event!] }));
        return;
      }
      if (event.type !== "text-delta" || !event.delta) return;
      const offsetKey = `${event.roomId}:${event.turnId}`;
      const previousOffset = streamOffsetsRef.current.get(offsetKey) || 0;
      const nextOffset = Number(event.streamOffset) || previousOffset + 1;
      if (nextOffset <= previousOffset) return;
      if (nextOffset > previousOffset + 1 && room?.id === event.roomId) void refreshRooms(event.roomId);
      streamOffsetsRef.current.set(offsetKey, nextOffset);
      setStreams((current) => ({ ...current, [event.turnId]: `${current[event.turnId] || ""}${event.delta}` }));
    });
    const offPermission = window.agentDesktop.groupRooms.onPermissionRequest((request) => {
      setPermissions((current) => [...current.filter((entry) => entry.requestId !== request.requestId), request]);
    });
    const offResolved = window.agentDesktop.groupRooms.onPermissionResolved(({ requestId }) => {
      setPermissions((current) => current.filter((entry) => entry.requestId !== requestId));
    });
    const offAssistants = window.agentDesktop.onAssistantsChanged(() => { if (enabled) void refreshResources(); });
    const offSettings = window.agentDesktop.onSettingsChanged((settings) => {
      const nextEnabled = settings.advanced?.moss_group_rooms === true;
      setEnabled(nextEnabled);
      if (nextEnabled) void Promise.all([refreshRooms(), refreshResources(), refreshPermissions()]);
      else {
        setRoom(null);
        setRooms([]);
      }
    });
    const connectorHandler = window.agentDesktop.ipcOn("connector-hub:changed", () => { if (enabled) void refreshResources(); });
    return () => {
      offEvent(); offStream(); offPermission(); offResolved(); offAssistants(); offSettings();
      window.agentDesktop.ipcOff("connector-hub:changed", connectorHandler);
    };
  }, [enabled, refreshPermissions, refreshResources, refreshRooms, room?.id]);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError("");
    try { await action(); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const enableFeature = () => run(async () => {
    await window.agentDesktop.updateSettings({
      advanced: { moss_group_rooms: true },
    } as Partial<DesktopSettings>);
    setEnabled(true);
    await Promise.all([refreshRooms(), refreshResources(), refreshPermissions()]);
  });

  const createRoom = (input: Parameters<CreateRoomFormProps["onCreate"]>[0]) => run(async () => {
    const created = unwrap(await window.agentDesktop.groupRooms.create(input));
    setCreating(false);
    await refreshRooms(created.id);
  });

  const selectRoom = (roomId: string, memberId: string | null = null) => run(async () => {
    const detail = unwrap(await window.agentDesktop.groupRooms.get({ roomId }));
    setRoom(detail);
    setCreating(false);
    setComposer("");
    setSelectedMemberId(memberId && detail.members.some((member) => member.id === memberId) ? memberId : null);
    setExpandedRoomIds((current) => new Set(current).add(detail.id));
  });

  const dispatch = () => run(async () => {
    if (!room || !composer.trim()) return;
    unwrap(await window.agentDesktop.groupRooms.dispatch({
      roomId: room.id,
      content: composer.trim(),
    }));
    setComposer("");
  });

  const intervene = (interventionMode: "soft" | "hard") => run(async () => {
    if (!room || !composer.trim()) return;
    unwrap(await window.agentDesktop.groupRooms.intervene({ roomId: room.id, content: composer.trim(), mode: interventionMode }));
    setComposer("");
  });

  const updateGrants = (member: GroupRoomMember, connectorGrants: GroupRoomConnectorGrant[], skillCommands = member.grants.skills) => run(async () => {
    if (!room) return;
    const updated = unwrap(await window.agentDesktop.groupRooms.updateMemberGrants({
      roomId: room.id,
      memberId: member.id,
      grants: { connectors: connectorGrants, skills: skillCommands },
      expectedRevision: room.revision,
    }));
    setRoom(updated);
  });

  const stopMember = (memberId: string) => run(async () => {
    if (!room) return;
    unwrap(await window.agentDesktop.groupRooms.stopMember({ roomId: room.id, memberId }));
  });

  const stopRoom = () => run(async () => {
    if (!room) return;
    unwrap(await window.agentDesktop.groupRooms.stop({ roomId: room.id }));
  });

  const updateRoomPermission = (permissionMode: "inherit" | "ask" | "allow-all") => run(async () => {
    if (!room) return;
    const updated = unwrap(await window.agentDesktop.groupRooms.update({
      roomId: room.id,
      updates: { settings: { ...room.settings, permissionMode } },
      expectedRevision: room.revision,
    }));
    setRoom(updated);
  });

  const refreshMemberSource = (memberId: string) => run(async () => {
    if (!room) return;
    const updated = unwrap(await window.agentDesktop.groupRooms.refreshMemberSource({
      roomId: room.id,
      memberId,
      expectedRevision: room.revision,
    }));
    setRoom(updated);
    await refreshResources();
  });

  const removeRoom = () => run(async () => {
    if (!room || !window.confirm(`删除群聊“${room.title}”？`)) return;
    unwrap(await window.agentDesktop.groupRooms.delete({ roomId: room.id }));
    setRoom(null);
    setComposer("");
    await refreshRooms();
  });

  if (enabled === null) {
    return <div className="absolute inset-0 flex min-h-0 min-w-0 items-center justify-center overflow-hidden"><LoaderCircle className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  }
  if (!enabled) {
    return (
      <div className="absolute inset-0 flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-background px-6">
        <div className="w-full max-w-sm text-center">
          <UsersRound className="mx-auto h-9 w-9 text-muted-foreground" />
          <h1 className="mt-4 text-base font-semibold">群聊</h1>
          <Button className="mt-5" onClick={enableFeature} disabled={busy}>
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
            启用
          </Button>
          {error ? <p className="mt-3 text-xs text-destructive">{error}</p> : null}
        </div>
      </div>
    );
  }
  if (creating) {
    return <CreateRoomForm resources={resources} busy={busy} onCancel={rooms.length > 0 ? () => setCreating(false) : undefined} globalBypassPermissions={globalBypassPermissions} onCreate={createRoom} />;
  }

  const selectedMember = room?.members.find((member) => member.id === selectedMemberId) || null;
  const selectedInviteable = selectedMember
    ? resources.inviteables.find((item) => item.id === selectedMember.source.id)
    : null;
  const currentSourceHash = selectedMember?.source.kind === "expert-team"
    ? selectedInviteable?.members.find((member) => member.id === selectedMember.source.memberId)?.sourceHash
    : selectedInviteable?.sourceHash;
  const sourceUpdateAvailable = Boolean(
    currentSourceHash
    && selectedMember?.source.hash
    && currentSourceHash !== selectedMember.source.hash,
  );
  const permission = permissions.find((entry) => entry.roomId === room?.id) || permissions[0];
  const latestRoomRun = room?.recentRuns[0];
  const pausedReason = room?.status === "paused" && latestRoomRun?.stopReason
    ? friendlyRunError(latestRoomRun.stopReason)
    : "";
  const connectorRefreshRequired = pausedReason.includes("连接器授权需要在连接器中心刷新");
  const activeDelegations = (room?.activeRun?.turns || [])
    .filter((turn) => turn.status === "pending" || turn.status === "running")
    .map((turn) => ({
      turn,
      member: room?.members.find((member) => member.id === turn.memberId),
      task: turn.assignment.length > 240 ? `${turn.assignment.slice(0, 240)}…` : turn.assignment,
    }))
    .filter((entry): entry is { turn: GroupRoomTurn; member: GroupRoomMember; task: string } => Boolean(entry.member));
  const activeDelegateNames = activeDelegations.map(({ member }) => member.displayName);
  const memberTranscript = room && selectedMember
    ? buildGroupRoomMemberTranscript({ room, memberId: selectedMember.id, streams, liveTraces })
    : [];
  return (
    <div className="absolute inset-0 flex min-h-0 min-w-0 overflow-hidden bg-background">
      {!roomListCollapsed ? <aside data-group-room-list className="hidden h-full w-56 shrink-0 flex-col border-r border-border lg:flex">
        <div className="flex h-14 items-center gap-1 border-b border-border px-2">
          <span className="min-w-0 flex-1 px-1 text-sm font-semibold">群聊</span>
          <Button size="icon" variant="ghost" onClick={() => setCreating(true)} title="新建群聊"><Plus className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => void refreshRooms()} title="刷新"><RefreshCw className="h-4 w-4" /></Button>
          <Button size="icon" variant="ghost" onClick={() => setRoomListCollapsed(true)} title="折叠群聊列表"><PanelLeftClose className="h-4 w-4" /></Button>
        </div>
        <ScrollArea className="min-h-0 flex-1 overflow-hidden">
          <div className="space-y-1 p-2">
            {rooms.map((entry) => {
              const expanded = expandedRoomIds.has(entry.id);
              const members = entry.members || (entry.id === room?.id ? room.members : []);
              return (
                <div key={entry.id}>
                  <div className={cn("flex h-12 items-center rounded-md", room?.id === entry.id && selectedMemberId === null ? "bg-primary/10" : "hover:bg-muted") }>
                    <button
                      type="button"
                      className="flex h-full w-8 shrink-0 items-center justify-center text-muted-foreground"
                      title={expanded ? "收起成员" : "展开成员"}
                      onClick={() => setExpandedRoomIds((current) => {
                        const next = new Set(current);
                        if (next.has(entry.id)) next.delete(entry.id); else next.add(entry.id);
                        return next;
                      })}
                    >
                      <ChevronRight className={cn("h-3.5 w-3.5 transition-transform", expanded && "rotate-90")} />
                    </button>
                    <button type="button" onClick={() => void selectRoom(entry.id)} className="flex h-full min-w-0 flex-1 items-center gap-2 pr-2 text-left">
                      <span className={cn("h-2 w-2 shrink-0 rounded-full", statusDot(entry.status))} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{entry.title}</span>
                        <span className="block truncate text-[11px] text-muted-foreground">{formatTime(entry.updatedAt)}</span>
                      </span>
                    </button>
                  </div>
                  {expanded ? (
                    <div className="ml-4 border-l border-border py-1 pl-2">
                      {members.map((member) => {
                        const activeTurn = entry.id === room?.id && room
                          ? activeTurnForMember(room, member.id)
                          : null;
                        return (
                          <button
                            key={member.id}
                            type="button"
                            onClick={() => void selectRoom(entry.id, member.id)}
                            className={cn(
                              "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-xs",
                              entry.id === room?.id && selectedMemberId === member.id ? "bg-muted font-medium" : "text-muted-foreground hover:bg-muted/70",
                            )}
                          >
                            <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot(activeTurn?.status || member.status))} />
                            <span className="min-w-0 flex-1 truncate">{member.displayName}</span>
                          </button>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </ScrollArea>
      </aside> : null}

      <main data-group-room-chat className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {error ? <div className="shrink-0 border-b border-destructive/30 bg-destructive/8 px-4 py-2 text-xs text-destructive">{error}</div> : null}
        {room ? (
          <>
            <header className="flex h-14 min-w-0 shrink-0 items-center gap-3 overflow-hidden border-b border-border px-3 sm:px-4">
              {roomListCollapsed ? (
                <Button className="hidden lg:inline-flex" size="icon" variant="ghost" onClick={() => setRoomListCollapsed(false)} title="展开群聊列表">
                  <PanelLeftOpen className="h-4 w-4" />
                </Button>
              ) : null}
              {!selectedMember ? (
                <>
                  <Button className="lg:hidden" size="icon" variant="ghost" onClick={() => setCreating(true)} title="新建群聊"><MessageSquarePlus className="h-4 w-4" /></Button>
                  <select className="min-w-0 max-w-36 flex-1 bg-transparent text-sm font-semibold outline-none lg:hidden" value={room.id} onChange={(event) => void selectRoom(event.target.value)}>
                    {rooms.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}
                  </select>
                  <select
                    aria-label="查看成员执行"
                    className="min-w-0 max-w-32 bg-transparent text-xs text-muted-foreground outline-none lg:hidden"
                    value=""
                    onChange={(event) => setSelectedMemberId(event.target.value || null)}
                  >
                    <option value="">房间结论</option>
                    {room.members.map((member) => <option key={member.id} value={member.id}>{member.displayName}</option>)}
                  </select>
                </>
              ) : null}
              {selectedMember ? (
                <>
                  <Button size="icon" variant="ghost" onClick={() => setSelectedMemberId(null)} title="返回房间"><ArrowLeft className="h-4 w-4" /></Button>
                  <MemberAvatar member={selectedMember} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{selectedMember.displayName}</div>
                    <div className="truncate text-xs text-muted-foreground">{room.title} · {selectedMember.role}</div>
                  </div>
                </>
              ) : (
                <div className="hidden min-w-0 flex-1 lg:block">
                  <div className="truncate text-sm font-semibold">{room.title}</div>
                  <div className="truncate text-xs text-muted-foreground">{room.topic}</div>
                </div>
              )}
              <span className="hidden text-xs text-muted-foreground sm:inline">主持人 · {statusLabel(room.status)}</span>
              {selectedMember && sourceUpdateAvailable ? <Button size="icon" variant="ghost" disabled={room.status === "running"} onClick={() => void refreshMemberSource(selectedMember.id)} title="刷新专家快照"><RefreshCw className="h-4 w-4" /></Button> : null}
              {selectedMember ? <Button size="icon" variant="ghost" disabled={room.status === "running"} onClick={() => setResourceMemberId(selectedMember.id)} title="成员资源"><Settings2 className="h-4 w-4" /></Button> : null}
              {selectedMember && activeTurnForMember(room, selectedMember.id)?.status === "running" ? <Button size="icon" variant="ghost" onClick={() => void stopMember(selectedMember.id)} title="停止该成员"><CircleStop className="h-4 w-4 text-destructive" /></Button> : null}
              {room.status === "running" ? (
                <Button size="icon" variant="ghost" onClick={() => void stopRoom()} title="停止全部成员">
                  <CircleStop className="h-4 w-4 text-destructive" />
                </Button>
              ) : null}
              {!selectedMember ? <Button size="icon" variant="ghost" onClick={removeRoom} title="删除群聊"><Trash2 className="h-4 w-4" /></Button> : null}
            </header>

            {pausedReason ? (
              <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs sm:px-4">
                <TriangleAlert className="h-3.5 w-3.5 shrink-0 text-amber-600" />
                <span className="min-w-0 flex-1 truncate" title={pausedReason}>{pausedReason}。可继续向主持人发送新请求。</span>
                {connectorRefreshRequired && onOpenConnectorHub ? <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={onOpenConnectorHub}>连接器中心</Button> : null}
              </div>
            ) : null}

            {!selectedMember && room.status === "running" && activeDelegations.length > 0 ? (
              <div data-group-room-delegation-status className="shrink-0 border-b border-emerald-500/25 bg-emerald-500/5 px-3 py-2 sm:px-4">
                <div className="mx-auto flex w-full max-w-[1180px] min-w-0 items-start gap-2">
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium text-foreground">主持人已委派，正在执行</div>
                    <div className="mt-1 flex min-w-0 flex-wrap gap-1.5">
                      {activeDelegations.map(({ turn, member, task }) => (
                        <button
                          key={turn.id}
                          type="button"
                          onClick={() => setSelectedMemberId(member.id)}
                          className="max-w-full rounded-md border border-emerald-500/25 bg-background px-2 py-1 text-left text-[11px] hover:bg-emerald-500/10"
                          title={`${member.displayName}：${turn.assignment.slice(0, 1_000)}`}
                        >
                          <span className="font-medium text-emerald-700 dark:text-emerald-400">{member.displayName}</span>
                          <span className="text-muted-foreground"> · {turn.status === "running" ? "执行中" : "等待中"} · {task}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {selectedMember ? (
              <div data-group-room-message-scroll className="flex min-h-0 flex-1 overflow-hidden" aria-label={`${selectedMember.displayName} 执行会话`}>
                <MessageListPane
                  className="min-h-0 flex-1 overflow-hidden"
                  workspace={room.workspace}
                  messages={memberTranscript}
                  loading={activeTurnForMember(room, selectedMember.id)?.status === "running"}
                  emptyState={<div className="px-4 py-8 text-center text-sm text-muted-foreground">暂无执行记录</div>}
                />
              </div>
            ) : (
              <ScrollArea data-group-room-message-scroll className="min-h-0 min-w-0 flex-1 overflow-hidden">
                <div className="mx-auto w-full min-w-0 max-w-[1180px] px-3 py-5 sm:px-4">
                  <div className="space-y-5">
                    {room.messages.map((message) => {
                      const member = room.members.find((entry) => entry.id === message.authorId);
                      const isHuman = message.authorType === "human";
                      const isSystem = message.authorType === "system";
                      const isModerator = message.authorType === "moderator";
                      const isQueued = message.status === "queued";
                      return (
                        <article key={message.id} className={cn("flex gap-3", isHuman && "justify-end") }>
                          {!isHuman && member ? <MemberAvatar member={member} /> : null}
                          {isModerator ? <ModeratorAvatar /> : null}
                          <div className={cn("min-w-0 max-w-[85%] [overflow-wrap:anywhere]", isHuman && "text-right") }>
                            <div className="mb-1 text-[11px] text-muted-foreground">
                              {isHuman ? "你" : isModerator ? "主持人" : isSystem ? "系统" : member?.displayName || "Agent"} · {formatTime(message.createdAt)}{isQueued ? " · 已排队给主持人" : ""}
                            </div>
                            <div className={cn("whitespace-pre-wrap break-words rounded-md px-3 py-2 text-sm leading-6", isHuman ? "bg-primary text-primary-foreground" : "border border-border bg-muted/25 text-left", isQueued && "opacity-70")}>{message.content}</div>
                          </div>
                          {isHuman ? <HumanAvatar /> : null}
                        </article>
                      );
                    })}
                    {room.activeRun?.turns.map((turn) => streams[turn.id] ? (
                      <article key={`stream-${turn.id}`} className="flex gap-3 opacity-75">
                        <MemberAvatar member={room.members.find((entry) => entry.id === turn.memberId)!} />
                        <div className="min-w-0 max-w-[85%] whitespace-pre-wrap [overflow-wrap:anywhere] rounded-md border border-dashed border-border px-3 py-2 text-sm leading-6">{streams[turn.id]}</div>
                      </article>
                    ) : null)}
                  </div>
                </div>
              </ScrollArea>
            )}

            <div data-group-room-composer className="relative z-10 min-w-0 shrink-0 border-t border-border bg-background px-3 py-3 sm:px-4">
              <div data-group-room-composer-track className="mx-auto w-full max-w-[1180px] space-y-2">
                <div data-group-room-controls className="flex min-w-0 flex-nowrap items-center gap-2 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  <select
                    aria-label="群权限"
                    className="h-8 shrink-0 rounded-md border border-border bg-background px-2 text-xs outline-none disabled:opacity-50"
                    value={room.settings.permissionMode || "inherit"}
                    disabled={room.status === "running" || busy}
                    title="优先级：群权限、全局权限、工作区规则"
                    onChange={(event) => void updateRoomPermission(event.target.value as "inherit" | "ask" | "allow-all")}
                  >
                    <option value="inherit">权限：继承全局（{globalBypassPermissions ? "允许" : "按规则"}）</option>
                    <option value="ask">权限：群内确认</option>
                    <option value="allow-all">权限：群内允许</option>
                  </select>
                  <span className="shrink-0 text-[11px] text-muted-foreground">
                    {room.status === "running"
                      ? activeDelegateNames.length > 0
                        ? `主持人已委派：${activeDelegateNames.join("、")}`
                        : "主持人正在判断下一步"
                      : "消息将发送给主持人，由主持人决定是否委派专家"}
                  </span>
                </div>
                <div className="flex min-w-0 shrink-0 items-end gap-2">
                  <Textarea value={composer} onChange={(event) => setComposer(event.target.value)} placeholder={room.status === "running" ? "继续发送给主持人（可连续补充）" : "向主持人说明你的目标"} className="max-h-40 min-h-16 min-w-0 resize-none" onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (room.status === "running") void intervene("soft"); else void dispatch();
                    }
                  }} />
                  {room.status === "running" ? (
                    <div className="flex shrink-0 flex-col gap-2">
                      <Button size="icon" disabled={!composer.trim() || busy} onClick={() => void intervene("soft")} title="发送补充给主持人"><Send className="h-4 w-4" /></Button>
                      <Button size="icon" variant="outline" disabled={!composer.trim() || busy} onClick={() => void intervene("hard")} title="立即中止，并把这条消息留给主持人"><CircleStop className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  ) : (
                    <Button size="icon" disabled={!composer.trim() || busy} onClick={() => void dispatch()} title="发送给主持人"><Send className="h-4 w-4" /></Button>
                  )}
                </div>
              </div>
            </div>
          </>
        ) : null}
      </main>

      {room && resourceMemberId ? (() => {
        const member = room.members.find((entry) => entry.id === resourceMemberId);
        return member ? (
          <MemberResourceDialog
            room={room}
            member={member}
            connectors={resources.connectors}
            skills={resources.skills}
            busy={busy}
            onClose={() => setResourceMemberId(null)}
            onSave={async (connectorGrants, skillCommands) => {
              await updateGrants(member, connectorGrants, skillCommands);
              setResourceMemberId(null);
            }}
          />
        ) : null;
      })() : null}

      {permission ? (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/75 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-md border border-border bg-background shadow-xl">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Cable className="h-4 w-4" />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">工具确认</div>
                <div className="truncate text-xs text-muted-foreground">{permission.roomTitle} · {permission.memberName}</div>
                <div className="truncate text-xs text-muted-foreground">{permission.connectorId ? `${permission.connectorId} · ` : ""}{permission.toolName}</div>
              </div>
            </div>
            <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all px-4 py-3 text-xs leading-5 text-muted-foreground">{traceText({ type: "tool_call", input: permission.input })}</pre>
            <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
              <Button variant="ghost" className="mr-auto text-destructive hover:text-destructive" onClick={() => void run(async () => {
                unwrap(await window.agentDesktop.groupRooms.stop({ roomId: permission.roomId }));
              })}><CircleStop className="h-4 w-4" />停止当前执行</Button>
              <Button variant="outline" onClick={() => void run(async () => {
                unwrap(await window.agentDesktop.groupRooms.resolvePermission({ requestId: permission.requestId, allowed: false }));
              })}>拒绝</Button>
              <Button onClick={() => void run(async () => {
                unwrap(await window.agentDesktop.groupRooms.resolvePermission({ requestId: permission.requestId, allowed: true }));
              })}>允许一次</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
