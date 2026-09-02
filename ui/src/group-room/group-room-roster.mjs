function stringList(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => String(entry || '').trim()).filter(Boolean))]
    : [];
}

export function buildGroupRoomChildSessionTitle({ memberName, agentName, description, agentType }) {
  const displayName = typeof memberName === 'string' ? memberName.trim() : '';
  const stableName = typeof agentName === 'string' ? agentName.trim() : '';
  const rawDescription = typeof description === 'string' ? description.trim() : '';
  const taskDescription = rawDescription && rawDescription !== stableName ? rawDescription : '';
  if (displayName) return `${displayName}${taskDescription ? ` · ${taskDescription}` : ''}`;
  if (taskDescription) return taskDescription;
  const fallbackType = typeof agentType === 'string' ? agentType.trim() : '';
  return fallbackType || '子会话';
}

export function extractPersistedWorkerMappings(history, members) {
  const allowedNames = new Set((Array.isArray(members) ? members : []).map((member) => member.id));
  const launches = [];
  const byToolUseId = new Map();
  for (const event of Array.isArray(history) ? history : []) {
    const content = Array.isArray(event?.message?.content) ? event.message.content : [];
    if (event?.type === 'assistant') {
      for (const block of content) {
        if (block?.type !== 'tool_use' || (block.name !== 'Agent' && block.name !== 'Task')) continue;
        const name = typeof block.input?.name === 'string' ? block.input.name.trim() : '';
        if (!allowedNames.has(name)) continue;
        const launch = { toolUseId: String(block.id || ''), name, agentId: '' };
        launches.push(launch);
        if (launch.toolUseId) byToolUseId.set(launch.toolUseId, launch);
      }
      continue;
    }
    const result = event?.tool_use_result || event?.toolUseResult;
    const agentId = typeof result?.agentId === 'string' ? result.agentId.trim() : '';
    if (!agentId) continue;
    const resultName = typeof result?.name === 'string' ? result.name.trim() : '';
    const toolUseId = String(
      event?.parent_tool_use_id
      || event?.tool_use_id
      || result?.toolUseId
      || content.find((block) => block?.type === 'tool_result')?.tool_use_id
      || '',
    );
    const launch = (allowedNames.has(resultName) ? launches.find((entry) => entry.name === resultName) : null)
      || byToolUseId.get(toolUseId)
      || launches.find((entry) => !entry.agentId);
    if (launch) launch.agentId = agentId;
  }
  return launches.filter((entry) => entry.agentId).map(({ name, agentId }) => ({ name, agentId }));
}

export function validateGroupRoomRosterToolUse({ toolName, input, members, existingNames, taskIds }) {
  const roster = new Map((Array.isArray(members) ? members : []).map((member) => [member.id, member]));
  const payload = input && typeof input === 'object' ? input : {};
  if (toolName === 'TeamCreate' || toolName === 'TeamDelete') {
    return '群聊成员名单固定，主持人不能创建或删除临时团队。';
  }
  if (toolName === 'Agent' || toolName === 'Task') {
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const member = roster.get(name);
    if (!member) return '只能用 Agent 创建房间名单内的成员，并将 name 设置为该成员的 memberId。';
    if (payload.subagent_type !== 'general-purpose' || payload.expert_id !== member.id) {
      return `成员 ${member.displayName} 必须使用 general-purpose，并将 expert_id 设置为 ${member.id}。`;
    }
    if (payload.team_name) return '群聊成员必须作为原生后台 worker 运行，不能加入临时 team。';
    if (payload.isolation) return '群聊成员共享房间工作区，不能启用独立 worktree。';
    const allowedConnectors = new Set(member.connectorIds || []);
    const allowedSkills = new Set(member.skillIds || []);
    if (stringList(payload.connector_ids).some((id) => !allowedConnectors.has(id))) return `成员 ${member.displayName} 使用了未分配的连接器。`;
    if (stringList(payload.skill_ids).some((id) => !allowedSkills.has(id))) return `成员 ${member.displayName} 使用了未分配的技能。`;
    if (existingNames?.has(name)) return `成员 ${member.displayName} 已创建；请用 SendMessage 继续该成员，不能重复创建。`;
    return null;
  }
  if (toolName === 'SendMessage') {
    const recipient = typeof payload.to === 'string'
      ? payload.to.trim()
      : typeof payload.recipient === 'string' ? payload.recipient.trim() : '';
    if (!roster.has(recipient)) return 'SendMessage 只能发送给房间名单内的 memberId，不能广播或使用原始 agent ID。';
    if (!existingNames?.has(recipient)) return '该成员尚未创建；首次委派请使用 Agent。';
    return null;
  }
  if (toolName === 'TaskStop') {
    const taskId = typeof payload.task_id === 'string' ? payload.task_id.trim() : '';
    if (!taskId || !taskIds?.has(taskId)) return '只能停止本群聊成员对应的任务。';
  }
  return null;
}
