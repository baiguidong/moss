import { createHash, randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';

const ARCHIVE_SCHEMA_VERSION = 1;
const MAX_SNAPSHOTS_PER_RUN = 240;

function isObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function sanitizeTeamName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9]/g, '-').toLowerCase();
}

export function getTeamIncarnationId(team) {
  if (
    typeof team?.incarnationId === 'string'
    && /^[a-zA-Z0-9_-]{8,120}$/.test(team.incarnationId)
  ) return team.incarnationId;
  return createHash('sha256')
    .update(`${team?.name || ''}\0${Number(team?.createdAt) || 0}\0${team?.leadSessionId || ''}`)
    .digest('hex')
    .slice(0, 24);
}

export function deriveTeamPhase(tasks, terminalStatus = null) {
  if (terminalStatus === 'interrupted') return 'interrupted';
  if (terminalStatus === 'completed') return 'completed';
  if (tasks.length === 0) return 'forming';
  if (tasks.every((task) => task.status === 'completed')) return 'wrapping_up';
  if (tasks.some((task) => task.status === 'in_progress')) return 'executing';
  const pending = tasks.filter((task) => task.status === 'pending');
  if (pending.length > 0 && pending.every((task) => task.blocked === true)) return 'blocked';
  return 'ready';
}

export function isAgentTeamContinuationPrompt(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[。.!！?？]+$/g, '')
    .replace(/\s+/g, ' ');
  if (!normalized || normalized.length > 100) return false;
  return /^(继续(?:吧|执行|完成|上次(?:的)?任务|刚才(?:的)?任务)?|接着(?:做|完成|执行)?|恢复(?:执行|上次(?:的)?任务)?|continue(?: from where you left off| where you left off| the task)?|resume(?: the task)?)$/.test(normalized);
}

function normalizeTask(value) {
  if (!isObject(value) || typeof value.id !== 'string') return null;
  const status = ['pending', 'in_progress', 'completed'].includes(value.status)
    ? value.status
    : 'pending';
  return {
    id: value.id,
    subject: typeof value.subject === 'string' ? value.subject : `Task ${value.id}`,
    description: typeof value.description === 'string' ? value.description : '',
    activeForm: typeof value.activeForm === 'string' ? value.activeForm : '',
    owner: typeof value.owner === 'string' ? value.owner : null,
    status,
    blocks: Array.isArray(value.blocks) ? value.blocks.filter((item) => typeof item === 'string') : [],
    blockedBy: Array.isArray(value.blockedBy) ? value.blockedBy.filter((item) => typeof item === 'string') : [],
    metadata: isObject(value.metadata) ? value.metadata : {},
  };
}

function normalizeMember(value) {
  if (!isObject(value) || typeof value.name !== 'string') return null;
  return {
    agentId: typeof value.agentId === 'string' ? value.agentId : value.name,
    name: value.name,
    agentType: typeof value.agentType === 'string' ? value.agentType : '',
    model: typeof value.model === 'string' ? value.model : '',
    color: typeof value.color === 'string' ? value.color : '',
    joinedAt: Number(value.joinedAt) || null,
    cwd: typeof value.cwd === 'string' ? value.cwd : '',
    status: value.isActive === false ? 'idle' : 'running',
  };
}

function normalizeMessage(value, to = '') {
  if (!isObject(value)) return null;
  const timestamp = typeof value.timestamp === 'string'
    ? value.timestamp
    : new Date(Number(value.timestamp) || Date.now()).toISOString();
  const message = {
    to: typeof value.to === 'string' ? value.to : to,
    from: typeof value.from === 'string' ? value.from : 'unknown',
    text: typeof value.text === 'string' ? value.text : '',
    timestamp,
    read: value.read === true,
    color: typeof value.color === 'string' ? value.color : '',
    summary: typeof value.summary === 'string' ? value.summary : '',
  };
  return {
    id: createHash('sha256')
      .update(`${message.from}\0${message.to}\0${message.timestamp}\0${message.text}`)
      .digest('hex')
      .slice(0, 20),
    ...message,
  };
}

async function readJson(filePath) {
  try {
    return JSON.parse(await fsp.readFile(filePath, 'utf8'));
  } catch {
    return null;
  }
}

async function listDirectories(root) {
  try {
    return (await fsp.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function listJsonFiles(root) {
  try {
    return (await fsp.readdir(root, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .map((entry) => entry.name)
      .sort();
  } catch {
    return [];
  }
}

async function readTasks(tasksDir) {
  const files = await listJsonFiles(tasksDir);
  const tasks = (await Promise.all(files.map((file) => readJson(path.join(tasksDir, file)))))
    .map(normalizeTask)
    .filter(Boolean);
  return tasks.sort((left, right) => (
    Number.parseInt(left.id, 10) - Number.parseInt(right.id, 10)
    || left.id.localeCompare(right.id)
  ));
}

async function readMessages(inboxesDir) {
  const files = await listJsonFiles(inboxesDir);
  const messages = [];
  for (const file of files) {
    const values = await readJson(path.join(inboxesDir, file));
    if (!Array.isArray(values)) continue;
    const to = file.replace(/\.json$/i, '');
    messages.push(...values.map((value) => normalizeMessage(value, to)).filter(Boolean));
  }
  return messages.sort((left, right) => left.timestamp.localeCompare(right.timestamp));
}

function snapshotFingerprint(snapshot) {
  return createHash('sha256')
    .update(JSON.stringify({
      team: snapshot.team,
      tasks: snapshot.tasks,
      messages: snapshot.messages,
      phase: snapshot.phase,
    }))
    .digest('hex')
    .slice(0, 24);
}

async function atomicWriteJson(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await fsp.writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fsp.rename(temporaryPath, filePath);
}

function summarizeRun(run) {
  const latest = run.snapshots.at(-1) || null;
  return {
    incarnationId: run.incarnationId,
    teamName: run.teamName,
    description: latest?.team?.description || '',
    status: run.status,
    phase: latest?.phase || run.status,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    deletedAt: run.deletedAt || null,
    taskCounts: latest?.taskCounts || { total: 0, completed: 0, inProgress: 0, pending: 0, blocked: 0 },
  };
}

function buildSnapshot(team, tasks, messages, terminalStatus = null, capturedAt = new Date().toISOString()) {
  const normalizedTasksWithoutBlockState = tasks
    .map(normalizeTask)
    .filter((task) => task && task.metadata?._internal !== true);
  const tasksById = new Map(normalizedTasksWithoutBlockState.map((task) => [task.id, task]));
  const normalizedTasks = normalizedTasksWithoutBlockState.map((task) => ({
    ...task,
    blocked: task.status !== 'completed' && task.blockedBy.some((dependencyId) => (
      tasksById.get(dependencyId)?.status !== 'completed'
    )),
  }));
  const normalizedMessages = messages.map((value) => normalizeMessage(value, value?.to || '')).filter(Boolean);
  const members = Array.isArray(team?.members) ? team.members.map(normalizeMember).filter(Boolean) : [];
  const taskCounts = {
    total: normalizedTasks.length,
    completed: normalizedTasks.filter((task) => task.status === 'completed').length,
    inProgress: normalizedTasks.filter((task) => task.status === 'in_progress').length,
    pending: normalizedTasks.filter((task) => task.status === 'pending').length,
    blocked: normalizedTasks.filter((task) => task.blocked).length,
  };
  return {
    capturedAt,
    phase: deriveTeamPhase(normalizedTasks, terminalStatus),
    taskCounts,
    team: {
      name: typeof team?.name === 'string' ? team.name : '',
      description: typeof team?.description === 'string' ? team.description : '',
      createdAt: Number(team?.createdAt) || Date.now(),
      leadAgentId: typeof team?.leadAgentId === 'string' ? team.leadAgentId : '',
      leadSessionId: typeof team?.leadSessionId === 'string' ? team.leadSessionId : '',
      members,
    },
    tasks: normalizedTasks,
    messages: normalizedMessages,
  };
}

function getInterruptedRecoveryPlan(run) {
  if (!isObject(run) || run.status !== 'interrupted') return null;
  const snapshot = run.snapshots?.at(-1);
  if (!snapshot || !Array.isArray(snapshot.tasks)) return null;
  const tasksById = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const incompleteTasks = snapshot.tasks.filter((task) => task.status !== 'completed');
  const assignmentTasks = snapshot.tasks.filter((task) => (
    task.metadata?.agentTeamAssignment === true
  ));
  const leadSummaryTasks = incompleteTasks.filter((task) => (
    task.metadata?.agentTeamAssignment !== true
    && task.status === 'in_progress'
    && (!task.owner || task.owner === 'team-lead')
    && task.blocks.length === 0
    && task.blockedBy.length > 0
    && task.blockedBy.every((taskId) => {
      const dependency = tasksById.get(taskId);
      return dependency?.status === 'completed'
        && dependency.metadata?.agentTeamAssignment === true;
    })
  ));
  const canFinishFromLead = snapshot.tasks.length > 0
    && assignmentTasks.length > 0
    && (
      incompleteTasks.length === 0
      || leadSummaryTasks.length === incompleteTasks.length
    );
  const taskLines = incompleteTasks.map((task) => (
    `- #${task.id} ${task.subject} (${task.status})`
  ));
  const instruction = canFinishFromLead
    ? [
        '[Agent Team desktop restart recovery]',
        `The previous team "${run.teamName}" was interrupted by an application restart. Its live team and task directories no longer exist.`,
        'All member assignments and their dependencies were completed before the restart; only lead-owned synthesis/finalization remains.',
        'Use the teammate reports already present in the conversation to finish the user-facing result.',
        'Do not call TaskUpdate, SendMessage, or TeamDelete for the old team, and do not recreate member agents unless the recorded reports are genuinely insufficient.',
      ].join('\n')
    : [
        '[Agent Team desktop restart recovery]',
        `The previous team "${run.teamName}" was interrupted by an application restart. Its live team and task directories no longer exist, so its old task IDs cannot be updated.`,
        incompleteTasks.length > 0
          ? 'The following work was not durably completed:'
          : 'No durable assignment state was captured before the restart.',
        ...(taskLines.length > 0 ? taskLines : ['- Reconstruct the unfinished work from the conversation.']),
        'If the user wants to continue, create a new Agent Team incarnation and rerun only the missing work. Reuse completed reports from the conversation and do not repeat completed assignments.',
      ].join('\n');
  return {
    incarnationId: run.incarnationId,
    teamName: run.teamName,
    mode: canFinishFromLead ? 'finish_summary' : 'rerun_missing_members',
    incompleteTasks: incompleteTasks.map((task) => ({
      id: task.id,
      subject: task.subject,
      status: task.status,
    })),
    instruction,
  };
}

function getRecoveryCompletionMarker(attemptId) {
  return `<!-- moss-agent-team-recovery-complete:${attemptId} -->`;
}

function isUsableRecoveryConclusion(value, attemptId) {
  const text = String(value || '').trim();
  return text.length > 0
    && !/^(?:no response requested\.?|api error:|task not found)/i.test(text)
    && text.includes(getRecoveryCompletionMarker(attemptId));
}

function getHistoryUserPrompt(event) {
  if (event?.type !== 'user') return '';
  if (typeof event.prompt === 'string') return event.prompt;
  const content = event?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function getHistoryAssistantText(event) {
  if (event?.type !== 'assistant') return '';
  const content = event?.message?.content;
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n');
}

function getHistoryEventTimestamp(event) {
  const raw = event?.timestamp ?? event?.message?.timestamp;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function isSuccessfulHistoryResult(event) {
  return event?.type === 'result'
    && event.subtype === 'success'
    && event.is_error !== true;
}

export function createAgentTeamsService({
  mossHome,
  getSessionRecords,
  getSessionDir,
  emit = () => {},
  log = () => {},
  pollIntervalMs = 750,
}) {
  const teamsRoot = path.join(mossHome, 'teams');
  const tasksRoot = path.join(mossHome, 'tasks');
  const terminalRoot = path.join(tasksRoot, '.agent-team-terminals');
  const liveRuns = new Map();
  const missingObservations = new Map();
  const queues = new Map();
  let timer = null;
  let checkPromise = null;
  let archiveRecoveryLoaded = false;

  function resolveSessionRecord(leadSessionId, { includeDeleted = false } = {}) {
    if (!leadSessionId) return null;
    for (const record of getSessionRecords()) {
      if ((!includeDeleted && record?.deleted) || record?.isSubAgent) continue;
      if (record.id === leadSessionId || record.underlyingSessionId === leadSessionId) return record;
    }
    return null;
  }

  function resolveSessionId(leadSessionId) {
    return resolveSessionRecord(leadSessionId)?.id || null;
  }

  function archiveRoot(sessionId) {
    return path.join(getSessionDir(sessionId), 'agent-teams');
  }

  function runPath(sessionId, incarnationId) {
    return path.join(archiveRoot(sessionId), `${incarnationId}.json`);
  }

  function enqueue(sessionId, operation) {
    const previous = queues.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => {}).then(operation);
    queues.set(sessionId, next);
    return next.finally(() => {
      if (queues.get(sessionId) === next) queues.delete(sessionId);
    });
  }

  async function readRun(sessionId, incarnationId) {
    return readJson(runPath(sessionId, incarnationId));
  }

  async function writeRun(sessionId, run) {
    await atomicWriteJson(runPath(sessionId, run.incarnationId), run);
    const root = archiveRoot(sessionId);
    const runFiles = (await listJsonFiles(root)).filter((file) => file !== 'index.json');
    const runs = (await Promise.all(runFiles.map((file) => readJson(path.join(root, file)))))
      .filter((value) => isObject(value) && Array.isArray(value.snapshots));
    const index = {
      schemaVersion: ARCHIVE_SCHEMA_VERSION,
      sessionId,
      updatedAt: new Date().toISOString(),
      teams: runs.map(summarizeRun).sort((left, right) => right.createdAt - left.createdAt),
    };
    await atomicWriteJson(path.join(root, 'index.json'), index);
    emit('agent-teams:changed', await getSessionState(sessionId));
  }

  async function archiveSnapshot(
    sessionId,
    incarnationId,
    teamName,
    snapshot,
    status,
    runPatch = {},
  ) {
    return enqueue(sessionId, async () => {
      const existing = await readRun(sessionId, incarnationId);
      const now = snapshot.capturedAt;
      const nextFingerprint = snapshotFingerprint(snapshot);
      const lastSnapshot = existing?.snapshots?.at(-1);
      const sameSnapshot = lastSnapshot && snapshotFingerprint(lastSnapshot) === nextFingerprint;
      if (sameSnapshot && existing.status === status) return false;

      const snapshots = Array.isArray(existing?.snapshots) ? [...existing.snapshots] : [];
      if (!sameSnapshot) snapshots.push(snapshot);
      const run = {
        ...(isObject(existing) ? existing : {}),
        schemaVersion: ARCHIVE_SCHEMA_VERSION,
        sessionId,
        incarnationId,
        teamName,
        status,
        createdAt: Number(existing?.createdAt) || snapshot.team.createdAt || Date.now(),
        updatedAt: now,
        deletedAt: status === 'live' ? null : now,
        snapshots: snapshots.slice(-MAX_SNAPSHOTS_PER_RUN),
        ...runPatch,
      };
      await writeRun(sessionId, run);
      return true;
    });
  }

  async function getRecoveryPlan(sessionId) {
    const state = await getSessionState(sessionId);
    return getInterruptedRecoveryPlan(state.teams[0]);
  }

  async function retireMissingLiveRunForRecovery(sessionId) {
    const state = await getSessionState(sessionId);
    const run = state.teams[0];
    if (!run || run.status !== 'live') return false;
    const team = await readJson(path.join(
      teamsRoot,
      sanitizeTeamName(run.teamName),
      'config.json',
    ));
    if (isObject(team) && getTeamIncarnationId(team) === run.incarnationId) {
      return false;
    }
    const last = run.snapshots?.at(-1);
    if (!last) return false;
    const status = last.tasks.length > 0
      && last.tasks.every((task) => task.status === 'completed')
      ? 'completed'
      : 'interrupted';
    const snapshot = {
      ...last,
      capturedAt: new Date().toISOString(),
      phase: status,
    };
    await archiveSnapshot(sessionId, run.incarnationId, run.teamName, snapshot, status);
    liveRuns.delete(run.incarnationId);
    missingObservations.delete(run.incarnationId);
    return true;
  }

  async function prepareRecoveryForTurn(sessionId) {
    await checkNow();
    await retireMissingLiveRunForRecovery(sessionId);
    const plan = await getRecoveryPlan(sessionId);
    if (!plan) return null;
    const attempt = {
      id: randomUUID(),
      mode: plan.mode,
      startedAt: Date.now(),
      status: 'active',
    };
    const prepared = await enqueue(sessionId, async () => {
      const run = await readRun(sessionId, plan.incarnationId);
      const currentPlan = getInterruptedRecoveryPlan(run);
      if (!currentPlan || currentPlan.mode !== plan.mode) return false;
      await writeRun(sessionId, {
        ...run,
        recoveryAttempt: attempt,
      });
      return true;
    });
    if (!prepared) return null;
    const instruction = plan.mode === 'finish_summary'
      ? [
          plan.instruction,
          'Only after you have genuinely completed the final user-facing result, append this exact invisible completion marker to the end of the response:',
          getRecoveryCompletionMarker(attempt.id),
          'Do not emit the marker while waiting, asking for more work, or reporting an error.',
        ].join('\n')
      : plan.instruction;
    return { ...plan, attemptId: attempt.id, instruction };
  }

  async function reconcileRecoveryTurn(
    sessionId,
    incarnationId,
    attemptId,
    { assistantText, turnSucceeded } = {},
  ) {
    if (
      turnSucceeded !== true
      || !isUsableRecoveryConclusion(assistantText, attemptId)
    ) return false;
    const run = await readRun(sessionId, incarnationId);
    const plan = getInterruptedRecoveryPlan(run);
    if (
      !plan
      || plan.mode !== 'finish_summary'
      || run.recoveryAttempt?.id !== attemptId
      || run.recoveryAttempt?.status !== 'active'
      || run.recoveryAttempt?.mode !== 'finish_summary'
    ) return false;
    const last = run.snapshots.at(-1);
    const completedTasks = last.tasks.map((task) => task.status === 'completed'
      ? task
      : {
          ...task,
          owner: task.owner || 'team-lead',
          status: 'completed',
          metadata: {
            ...task.metadata,
            agentTeamRecoveredAfterRestart: true,
          },
        });
    const recoveredTeam = {
      ...last.team,
      members: last.team.members.map((member) => ({
        ...member,
        isActive: false,
      })),
    };
    const capturedAt = new Date().toISOString();
    const snapshot = {
      ...buildSnapshot(
        recoveredTeam,
        completedTasks,
        last.messages,
        'completed',
        capturedAt,
      ),
      recovery: {
        type: 'desktop_restart_continuation',
        recoveredAt: capturedAt,
      },
    };
    return archiveSnapshot(
      sessionId,
      incarnationId,
      run.teamName,
      snapshot,
      'completed',
      {
        recoveryAttempt: {
          ...run.recoveryAttempt,
          status: 'completed',
          completedAt: Date.now(),
        },
      },
    );
  }

  async function reconcilePersistedContinuations(sessionId = null) {
    for (const record of getSessionRecords()) {
      if (!record?.id || record.deleted || record.isSubAgent || record.busy) continue;
      if (sessionId && record.id !== sessionId) continue;
      const state = await getSessionState(record.id);
      const run = state.teams[0];
      const plan = getInterruptedRecoveryPlan(run);
      const attempt = run?.recoveryAttempt;
      if (
        !plan
        || plan.mode !== 'finish_summary'
        || attempt?.status !== 'active'
        || attempt.mode !== 'finish_summary'
        || !Number.isFinite(attempt.startedAt)
      ) continue;
      const history = Array.isArray(record.history) ? record.history : [];
      let continuationIndex = -1;
      for (let index = 0; index < history.length; index += 1) {
        const event = history[index];
        if (!isAgentTeamContinuationPrompt(getHistoryUserPrompt(event))) continue;
        const timestamp = getHistoryEventTimestamp(event);
        if (timestamp === null || timestamp < attempt.startedAt) continue;
        continuationIndex = index;
      }
      if (continuationIndex < 0) continue;
      let nextUserIndex = history.length;
      for (let index = continuationIndex + 1; index < history.length; index += 1) {
        if (getHistoryUserPrompt(history[index]).trim()) {
          nextUserIndex = index;
          break;
        }
      }
      const turnHistory = history.slice(continuationIndex + 1, nextUserIndex);
      const resultIndex = turnHistory.findLastIndex(isSuccessfulHistoryResult);
      if (resultIndex < 0) continue;
      const result = turnHistory[resultIndex];
      const conclusion = String(result?.result || '').trim()
        || turnHistory
          .slice(0, resultIndex + 1)
          .map(getHistoryAssistantText)
          .filter((text) => isUsableRecoveryConclusion(text, attempt.id))
          .at(-1)
        || '';
      await reconcileRecoveryTurn(
        record.id,
        run.incarnationId,
        attempt.id,
        { assistantText: conclusion, turnSucceeded: true },
      );
    }
  }

  async function scanTerminalReceipts() {
    const files = await listJsonFiles(terminalRoot);
    for (const file of files) {
      const filePath = path.join(terminalRoot, file);
      const receipt = await readJson(filePath);
      if (!isObject(receipt) || !isObject(receipt.team)) continue;
      const incarnationId = typeof receipt.incarnationId === 'string'
        ? receipt.incarnationId
        : getTeamIncarnationId(receipt.team);
      const sessionRecord = resolveSessionRecord(
        receipt.team.leadSessionId,
        { includeDeleted: true },
      );
      if (!sessionRecord) continue;
      if (sessionRecord.deleted) {
        liveRuns.delete(incarnationId);
        missingObservations.delete(incarnationId);
        await fsp.rm(filePath, { force: true });
        continue;
      }
      const sessionId = sessionRecord.id;
      const status = receipt.reason === 'interrupted' ? 'interrupted' : 'completed';
      const snapshot = buildSnapshot(
        receipt.team,
        Array.isArray(receipt.tasks) ? receipt.tasks : [],
        Array.isArray(receipt.messages) ? receipt.messages : [],
        status,
        typeof receipt.capturedAt === 'string' ? receipt.capturedAt : new Date().toISOString(),
      );
      await archiveSnapshot(sessionId, incarnationId, receipt.teamName || receipt.team.name, snapshot, status);
      liveRuns.delete(incarnationId);
      missingObservations.delete(incarnationId);
      await fsp.rm(filePath, { force: true });
    }
  }

  async function discardTerminalReceiptsForSession(sessionId, leadSessionId) {
    const identifiers = new Set(
      [sessionId, leadSessionId]
        .map((value) => String(value || '').trim())
        .filter(Boolean),
    );
    if (identifiers.size === 0) return 0;
    let removed = 0;
    for (const file of await listJsonFiles(terminalRoot)) {
      const filePath = path.join(terminalRoot, file);
      const receipt = await readJson(filePath);
      if (!isObject(receipt) || !isObject(receipt.team)) continue;
      if (!identifiers.has(String(receipt.team.leadSessionId || '').trim())) continue;
      const incarnationId = typeof receipt.incarnationId === 'string'
        ? receipt.incarnationId
        : getTeamIncarnationId(receipt.team);
      liveRuns.delete(incarnationId);
      missingObservations.delete(incarnationId);
      await fsp.rm(filePath, { force: true });
      removed += 1;
    }
    return removed;
  }

  async function scanLiveTeams() {
    const seen = new Set();
    for (const directory of await listDirectories(teamsRoot)) {
      const teamDir = path.join(teamsRoot, directory);
      const team = await readJson(path.join(teamDir, 'config.json'));
      if (!isObject(team) || typeof team.name !== 'string') continue;
      const sessionId = resolveSessionId(team.leadSessionId);
      if (!sessionId) continue;
      const incarnationId = getTeamIncarnationId(team);
      const tasks = await readTasks(path.join(tasksRoot, sanitizeTeamName(team.name)));
      const messages = await readMessages(path.join(teamDir, 'inboxes'));
      const snapshot = buildSnapshot(team, tasks, messages);
      const existing = await readRun(sessionId, incarnationId);
      if (existing && existing.status !== 'live') {
        liveRuns.delete(incarnationId);
        missingObservations.delete(incarnationId);
        continue;
      }
      await archiveSnapshot(sessionId, incarnationId, team.name, snapshot, 'live');
      liveRuns.set(incarnationId, { sessionId, teamName: team.name });
      missingObservations.delete(incarnationId);
      seen.add(incarnationId);
    }

    if (!archiveRecoveryLoaded) {
      for (const record of getSessionRecords()) {
        if (!record?.id || record.deleted || record.isSubAgent) continue;
        const archived = await getSessionState(record.id);
        for (const run of archived.teams) {
          if (run.status === 'live' && !liveRuns.has(run.incarnationId)) {
            liveRuns.set(run.incarnationId, { sessionId: record.id, teamName: run.teamName });
          }
        }
      }
      archiveRecoveryLoaded = true;
    }

    for (const [incarnationId, live] of liveRuns) {
      if (seen.has(incarnationId)) continue;
      const observations = (missingObservations.get(incarnationId) || 0) + 1;
      missingObservations.set(incarnationId, observations);
      if (observations < 2) continue;
      const run = await readRun(live.sessionId, incarnationId);
      const last = run?.snapshots?.at(-1);
      if (last && run.status === 'live') {
        const status = last.tasks.length > 0 && last.tasks.every((task) => task.status === 'completed')
          ? 'completed'
          : 'interrupted';
        const snapshot = { ...last, capturedAt: new Date().toISOString(), phase: status };
        await archiveSnapshot(live.sessionId, incarnationId, live.teamName, snapshot, status);
      }
      liveRuns.delete(incarnationId);
      missingObservations.delete(incarnationId);
    }
  }

  async function checkNow() {
    if (checkPromise) return checkPromise;
    checkPromise = (async () => {
      await scanTerminalReceipts();
      await scanLiveTeams();
    })().catch((error) => {
      log('warn', 'agent-teams', 'Unable to refresh Agent Teams archive', {
        error: error instanceof Error ? error.message : String(error),
      });
    }).finally(() => {
      checkPromise = null;
    });
    return checkPromise;
  }

  async function getSessionState(sessionId) {
    const normalizedSessionId = String(sessionId || '').trim();
    if (!normalizedSessionId) return { sessionId: '', teams: [] };
    const root = archiveRoot(normalizedSessionId);
    const files = (await listJsonFiles(root)).filter((file) => file !== 'index.json');
    const teams = (await Promise.all(files.map((file) => readJson(path.join(root, file)))))
      .filter((value) => isObject(value) && Array.isArray(value.snapshots))
      .sort((left, right) => right.createdAt - left.createdAt);
    return { sessionId: normalizedSessionId, teams };
  }

  return {
    start() {
      if (timer) return;
      void checkNow().then(() => reconcilePersistedContinuations()).catch((error) => {
        log('warn', 'agent-teams', 'Unable to reconcile persisted Agent Team continuation', {
          error: error instanceof Error ? error.message : String(error),
        });
      });
      timer = setInterval(() => void checkNow(), pollIntervalMs);
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    checkNow,
    getSessionState,
    getRecoveryPlan,
    prepareRecoveryForTurn,
    reconcileRecoveryTurn,
    reconcilePersistedContinuations,
    discardTerminalReceiptsForSession,
  };
}
