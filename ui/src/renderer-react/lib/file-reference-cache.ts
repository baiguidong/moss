const cache = new Map<string, { expires: number; promise: Promise<boolean> }>();
const batches = new Map<string, Array<{ reference: string; resolve: (available: boolean) => void }>>();
export function resolveVisibleFileReference(sessionId: string, reference: string): Promise<boolean> {
  const key = JSON.stringify([sessionId, reference]), existing = cache.get(key);
  if (existing && existing.expires > Date.now()) return existing.promise;
  const promise = new Promise<boolean>(resolve => {
    const batch = batches.get(sessionId) || [];
    batch.push({ reference, resolve }); batches.set(sessionId, batch);
    if (batch.length !== 1) return;
    queueMicrotask(async () => {
      batches.delete(sessionId);
      for (let index = 0; index < batch.length; index += 32) {
        const part = batch.slice(index, index + 32);
        try {
          const results = await window.agentDesktop.presentation.resolve({ sessionId, references: part.map(item => item.reference) });
          part.forEach((item, i) => item.resolve(results[i]?.available === true));
        } catch { part.forEach(item => item.resolve(false)); }
      }
    });
  });
  cache.set(key, { expires: Date.now() + 10000, promise });
  while (cache.size > 512) cache.delete(cache.keys().next().value);
  return promise;
}
