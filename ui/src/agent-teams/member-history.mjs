import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseSubAgentTranscript } from '../shared/subagent-lifecycle.mjs';

// The caller supplies a resolved session directory and archived run, never a
// renderer-provided file path. Restrict replay to this run and selected frame.
export async function readTeamMemberHistory({ subagentDir, run, memberId, frame, nextCreatedAt = Infinity }) {
  if (!Number.isInteger(frame) || frame < 0 || frame >= run.snapshots.length) throw new Error('Invalid team frame.');
  const snapshot = run.snapshots[frame];
  const member = run.snapshots.slice(0, frame + 1).flatMap(item => item.team.members)
    .find(item => item.agentId === memberId);
  const assignment = snapshot.tasks.find(task => task.metadata?.agentTeamAssignment === true
    && task.metadata.agentTeamAgentId === memberId);
  const name = member?.name || assignment?.metadata?.agentTeamAgentName;
  if (typeof name !== 'string' || !name) throw new Error('Team member not found in this frame.');
  const cutoff = run.status === 'live' && frame === run.snapshots.length - 1
    ? Date.now() : Date.parse(snapshot.capturedAt);
  if (!Number.isFinite(cutoff) || !Number.isFinite(run.createdAt)) throw new Error('Invalid team archive time.');
  if (!subagentDir) return { history: [] };
  const entries = await fsp.readdir(subagentDir, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const events = new Map();
  for (const entry of entries) {
    if (!entry.isFile() || !/^agent-[a-zA-Z0-9_-]{1,160}\.meta\.json$/.test(entry.name)) continue;
    let meta;
    try { meta = JSON.parse(await fsp.readFile(path.join(subagentDir, entry.name), 'utf8')); }
    catch { continue; }
    if (meta.teamName !== run.teamName || meta.agentName !== name) continue;
    const transcript = path.join(subagentDir, entry.name.replace(/\.meta\.json$/, '.jsonl'));
    const stat = await fsp.lstat(transcript).catch(() => null);
    if (!stat?.isFile()) continue;
    const raw = await fsp.readFile(transcript, 'utf8');
    for (const event of parseSubAgentTranscript(raw).history) {
      const time = typeof event.timestamp === 'number' ? event.timestamp : Date.parse(event.timestamp);
      if (!Number.isFinite(time) || time < run.createdAt || time > cutoff || time >= nextCreatedAt) continue;
      // Continuations can copy their earlier transcript into multiple files.
      const key = event.uuid || createHash('sha256').update(JSON.stringify(event)).digest('hex');
      events.set(key, { event, time });
    }
  }
  return { history: [...events.values()].sort((a, b) => a.time - b.time).map(item => item.event) };
}
