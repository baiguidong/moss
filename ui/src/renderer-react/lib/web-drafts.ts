// One record per page writer: concurrent tabs never overwrite each other's draft.
export type WebDraft<T = unknown> = { id: string; scope: string; session: string; tab: string; updatedAt: number; value: T; noticeAcknowledged?: boolean };
let database: Promise<IDBDatabase> | undefined;
let loggingOut = false;
export function draftScope() {
  const identity = window.mossWeb?.identity;
  return identity ? JSON.stringify([identity.userId, identity.hostId, ...(identity.generation !== undefined ? [identity.generation] : [])]) : '';
}
function open() {
  return database ||= new Promise((resolve, reject) => {
    const request = indexedDB.open('moss-web-drafts', 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore('drafts', { keyPath: 'id' });
      store.createIndex('scope', 'scope');
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = undefined; reject(request.error); };
  });
}
export async function listDrafts<T>(scope: string, session?: string): Promise<WebDraft<T>[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').index('scope').getAll(scope);
    request.onsuccess = () => resolve(request.result.filter(row => session === undefined || row.session === session).sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
  });
}
export async function writeDraft(record: WebDraft) {
  if (loggingOut) return;
  const db = await open();
  if (loggingOut) return;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
    // Older writers may still be active in another tab; retain their copies.
    const request = store.get(record.id);
    request.onsuccess = () => {
      const previous: WebDraft | undefined = request.result;
      // Remounting saves again; only changed content needs another notice.
      const noticeAcknowledged = previous?.noticeAcknowledged === true && JSON.stringify(previous.value) === JSON.stringify(record.value);
      store.put({ ...record, noticeAcknowledged });
    };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}

/** Acknowledge only the version the user saw, without deleting its recovery copy. */
export async function acknowledgeDrafts(records: WebDraft[]) {
  if (!records.length || loggingOut) return;
  const db = await open();
  if (loggingOut) return;
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
    for (const record of records) {
      const request = store.get(record.id);
      request.onsuccess = () => {
        const stored: WebDraft | undefined = request.result;
        if (stored && JSON.stringify(stored.value) === JSON.stringify(record.value)) store.put({ ...stored, noticeAcknowledged: true });
      };
    }
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}
export async function clearUserDrafts() {
  loggingOut = true;
  const scope = draftScope();
  if (!scope) return;
  const db = await open();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite'), store = tx.objectStore('drafts');
    const request = store.index('scope').openCursor(scope);
    request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}

export async function listPriorDrafts<T>(scope: string): Promise<WebDraft<T>[]> {
  const identity = JSON.parse(scope), db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction('drafts').objectStore('drafts').getAll();
    request.onsuccess = () => resolve(request.result.filter(row => {
      try { const old = JSON.parse(row.scope); return row.scope !== scope && old[0] === identity[0] && old[1] === identity[1]; } catch { return false; }
    }).sort((a, b) => b.updatedAt - a.updatedAt));
    request.onerror = () => reject(request.error);
  });
}
