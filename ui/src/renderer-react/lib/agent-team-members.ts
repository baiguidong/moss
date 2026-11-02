import type { AgentTeamMember, AgentTeamMessage, AgentTeamRun, AgentTeamSnapshot, AgentTeamTask } from "../types";

export type TeamMemberView = AgentTeamMember & {
  present: boolean;
  activity: "working" | "idle" | "completed" | "departed" | "interrupted" | "ended";
};

export const MEMBER_ACTIVITY_LABELS: Record<TeamMemberView["activity"], string> = {
  working: "工作中",
  idle: "空闲",
  completed: "任务完成",
  departed: "已退出",
  interrupted: "已中断",
  ended: "已结束",
};

export function tasksForMember(tasks: AgentTeamTask[], member: AgentTeamMember) {
  return tasks.filter((task) => task.owner === member.name || task.owner === member.agentId);
}

export function visibleTeamMessages(messages: AgentTeamMessage[]) {
  return messages.filter((message) => {
    try {
      const value = JSON.parse(message.text);
      return !['idle_notification', 'shutdown_request', 'shutdown_response', 'shutdown_approved'].includes(value?.type);
    } catch { return true; }
  }).sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function messagesForMember(messages: AgentTeamMessage[], member: AgentTeamMember) {
  return visibleTeamMessages(messages).filter(message => [message.from, message.to].some(value => value === member.name || value === member.agentId));
}

export function memberMatchesQuery(member: AgentTeamMember, snapshot: AgentTeamSnapshot, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [member.name, member.agentType, member.model,
    ...tasksForMember(snapshot.tasks, member).flatMap(task => [task.subject, task.description, task.activeForm]),
  ].some(value => value.toLocaleLowerCase().includes(needle));
}

export function memberRelations(member: AgentTeamMember, members: AgentTeamMember[], snapshot: AgentTeamSnapshot) {
  const owned = tasksForMember(snapshot.tasks, member);
  const ids = new Set(owned.map(task => task.id));
  const dependencies = new Set(owned.flatMap(task => task.blockedBy));
  return members.filter(other => other.agentId !== member.agentId).map(other => {
    const tasks = tasksForMember(snapshot.tasks, other);
    const upstream = tasks.filter(task => dependencies.has(task.id)).length;
    const downstream = tasks.filter(task => task.blockedBy.some(id => ids.has(id))).length;
    const messages = messagesForMember(snapshot.messages, member).filter(message => [message.from, message.to].some(value => value === other.name || value === other.agentId)).length;
    return { member: other, upstream, downstream, messages };
  }).filter(relation => relation.upstream || relation.downstream || relation.messages);
}

// Team shutdown removes members from config.json. Keep participants visible in
// history, using only frames at or before the cursor so replay never reveals
// future members. Do not mutate the archive or infer that an exited agent ran.
export function getTeamMembersAtFrame(run: AgentTeamRun, frame = run.snapshots.length - 1): TeamMemberView[] {
  const index = Math.min(Math.max(0, frame), run.snapshots.length - 1);
  const snapshot = run.snapshots[index];
  if (!snapshot) return [];
  const members = new Map<string, AgentTeamMember>();
  for (const previous of run.snapshots.slice(0, index + 1)) {
    for (const member of previous.team.members) members.set(member.agentId, member);
  }
  // Archives are bounded. Explicit Agent Team assignments still identify a
  // participant whose membership frames have already fallen out of retention.
  for (const task of snapshot.tasks) {
    const { agentTeamAssignment, agentTeamAgentId, agentTeamAgentName } = task.metadata;
    if (agentTeamAssignment !== true || typeof agentTeamAgentId !== "string" || !agentTeamAgentId
      || typeof agentTeamAgentName !== "string" || !agentTeamAgentName || members.has(agentTeamAgentId)) continue;
    members.set(agentTeamAgentId, {
      agentId: agentTeamAgentId, name: agentTeamAgentName, agentType: "", model: "",
      color: "", joinedAt: null, cwd: "", status: "idle",
    });
  }
  const currentIds = new Set(snapshot.team.members.map((member) => member.agentId));
  const terminal = snapshot.phase === "completed" || snapshot.phase === "interrupted";
  return [...members.values()].map((member) => {
    const present = currentIds.has(member.agentId);
    const tasks = tasksForMember(snapshot.tasks, member);
    const completed = tasks.length > 0 && tasks.every((task) => task.status === "completed");
    const activity: TeamMemberView["activity"] = !terminal && present && member.status === "running"
      ? "working"
      : completed ? "completed"
        : terminal ? snapshot.phase === "interrupted" ? "interrupted" : "ended"
          : present ? "idle" : "departed";
    return { ...member, present, activity };
  });
}
