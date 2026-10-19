/** Trusted Host receipts associate supplements with the original observed turn. */
export function interactionTurnOwners(history) {
  const owners = new Map();
  for (const event of history || []) {
    if (event?.type === 'session_interaction' && event.kind === 'steer' && typeof event.id === 'string' && typeof event.turnId === 'string') owners.set(event.id, event.turnId);
  }
  return owners;
}
