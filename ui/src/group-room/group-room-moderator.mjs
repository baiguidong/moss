export const GROUP_ROOM_MODERATOR_ID = 'moderator';
export const GROUP_ROOM_USER_ID = 'user';

function text(value, max) {
  return String(value || '').trim().slice(0, max);
}

export function normalizeModeratorDecision(value, {
  memberIds,
  maxAssignments = 3,
  forceFinish = false,
} = {}) {
  const raw = value?.decision && typeof value.decision === 'object' ? value.decision : value;
  if (!raw || typeof raw !== 'object') throw new Error('Moderator returned no decision.');
  const action = String(raw.action || '').trim();
  if (action === 'respond') {
    const response = text(raw.response, 500_000);
    if (!response) throw new Error('Moderator returned an empty response.');
    return { action, response };
  }
  if (action !== 'delegate') throw new Error(`Moderator returned an unsupported action: ${action || 'empty'}.`);
  if (forceFinish) throw new Error('Moderator attempted to delegate after the safety boundary was reached.');

  const allowed = memberIds instanceof Set ? memberIds : new Set(memberIds || []);
  const inputs = Array.isArray(raw.assignments) ? raw.assignments : [];
  if (inputs.length < 1 || inputs.length > maxAssignments) {
    throw new Error(`Moderator must delegate to 1-${maxAssignments} members at a time.`);
  }
  const seen = new Set();
  const assignments = inputs.map((assignment) => {
    const memberId = text(assignment?.memberId, 160);
    const task = text(assignment?.task, 100_000);
    if (!allowed.has(memberId)) throw new Error(`Moderator selected an unavailable room member: ${memberId || 'empty'}.`);
    if (seen.has(memberId)) throw new Error(`Moderator selected the same member twice: ${memberId}.`);
    if (!task) throw new Error(`Moderator returned an empty assignment for ${memberId}.`);
    seen.add(memberId);
    return { memberId, task };
  });
  return {
    action,
    assignments,
    reason: text(raw.reason, 2_000),
  };
}
