import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { initialPresentationState, transitionPresentation, validatePresentationInput } from '../shared/presentation-contracts.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const failure = error => ({ ok: false, error: error instanceof Error ? error.message : String(error) });

/** Host-owned resources. A transcript is never used as an imperative UI command log. */
export function createPresentationService({ storageRoot, getSessionRecord, resolveItem, loadResource, emit, waitMs = 300 }) {
  const sessions = new Map(), loading = new Map(), requests = new Map(), waiters = new Map();
  let foreground = null;
  const fileFor = id => path.join(storageRoot, hash(id) + '.json');
  const signature = record => JSON.stringify([record.agentMode, record.workspace || '', record.remoteWorkspace || '', record.agentMode === 'remote-direct' ? record.underlyingSessionId || '' : '']);
  const sourceIdentity = source => source.type === 'file' ? { type: source.type, path: source.path, remote: Boolean(source.remote) } : source;

  async function session(id) {
    let record = getSessionRecord(id);
    if (!record || record.deleted) throw new Error('Session is unavailable');
    if (!sessions.has(id)) {
      if (!loading.has(id)) loading.set(id, (async () => {
        let saved;
        try { saved = JSON.parse(await fs.readFile(fileFor(id), 'utf8')); } catch {}
        const value = { id, signature: signature(record), epoch: randomUUID(), seq: 0, version: 0, resources: new Map(), results: new Map(), state: initialPresentationState(), writes: Promise.resolve() };
        if (saved?.schema === 'moss.presentation-session/v1' && saved.signature === value.signature) {
          value.resources = new Map((saved.resources || []).map(resource => [resource.id, resource.persistence === 'ephemeral' ? { ...resource, availability: 'expired' } : resource]));
          value.state = transitionPresentation(value.state, { type: 'restore', state: saved.state });
          value.seq = Math.max(saved.seq || 0, value.state.seq || 0, ...[...value.resources.values()].map(resource => resource.sequence || 0));
          value.results = new Map((saved.results || []).map(result => [result.request_id, result]));
          for (const result of value.results.values()) if (result.presentation?.state === 'pending') result.presentation = { state: 'deferred', reason: 'host_restarted', target: 'right' };
          value.state.dirty = [...value.resources.values()].some(resource => resource.dirty);
        }
        sessions.set(id, value);
      })().finally(() => loading.delete(id)));
      await loading.get(id);
    }
    const value = sessions.get(id);
    record = getSessionRecord(id);
    if (!record || record.deleted) throw new Error('Session is unavailable');
    if (value.signature !== signature(record)) {
      deferRequests(value, 'workspace_changed');
      value.signature = signature(record); value.epoch = randomUUID(); value.resources.clear(); value.results.clear(); value.state = initialPresentationState();
    }
    return value;
  }
  const snapshot = value => ({ sessionId: value.id, epoch: value.epoch, version: value.version, state: value.state, resources: [...value.resources.values()], results: [...value.results.values()], ...(value.request ? { request: value.request } : {}) });
  function requestCurrent(value, request) {
    return request.epoch === value.epoch && request.turnId === value.state.turnId
      && request.userIntentVersion === value.state.userIntentVersion && value.state.visible
      && request.artifactId === value.state.activeId && value.resources.get(request.artifactId)?.revision === request.revision;
  }
  function deferRequests(value, reason, predicate = () => true) {
    for (const [key, pending] of waiters) {
      if (pending.request.sessionId !== value.id || !predicate(pending.request)) continue;
      pending.result.presentation = { state: 'deferred', reason, target: 'right' };
      if (value.request === pending.request) value.request = null;
      pending.resolve(); waiters.delete(key);
      emit?.('presentation:result', { sessionId: value.id, result: pending.result });
    }
  }
  async function persist(value) {
    value.version++;
    // Serialize the snapshot now, not after awaiting another writer.
    const body = JSON.stringify({ schema: 'moss.presentation-session/v1', signature: value.signature, seq: value.seq, state: value.state, resources: [...value.resources.values()], results: [...value.results.values()] });
    value.writes = value.writes.catch(() => {}).then(async () => {
      await fs.mkdir(storageRoot, { recursive: true, mode: 0o700 });
      const temporary = fileFor(value.id) + '.' + randomUUID();
      try { await fs.writeFile(temporary, body, { mode: 0o600 }); await fs.rename(temporary, fileFor(value.id)); }
      finally { await fs.rm(temporary, { force: true }); }
    });
    await value.writes;
  }
  function notify(value, request) { emit?.('presentation:changed', { ...snapshot(value), ...(request ? { request } : {}) }); }
  function prune(value) {
    const retained = new Set([...value.state.openedIds, value.state.activeId, value.state.pinnedId]);
    for (const resource of value.resources.values()) if (resource.dirty) retained.add(resource.id);
    for (const id of retained) { const resource = value.resources.get(id); if (resource?.source.type === 'collection') for (const member of resource.source.memberIds) retained.add(member); }
    if (value.resources.size > 256) for (const id of value.resources.keys()) {
      if (value.resources.size <= 256) break;
      if (!retained.has(id)) value.resources.delete(id);
    }
    // Only the active/pinned collection is protected once the hard resource limit is reached.
    const essential = new Set([value.state.activeId, value.state.pinnedId]);
    for (const resource of value.resources.values()) if (resource.dirty) essential.add(resource.id);
    for (const id of essential) for (const member of value.resources.get(id)?.source.memberIds || []) essential.add(member);
    for (const id of value.resources.keys()) { if (value.resources.size <= 512) break; if (!essential.has(id)) value.resources.delete(id); }
    value.state.openedIds = value.state.openedIds.filter(id => ['workspace', 'browser', 'results'].includes(id) || value.resources.has(id));
  }
  async function submit(id, input, context = {}) {
    const value = await session(id), normalized = validatePresentationInput(input);
    if (context.epoch && value.epoch !== context.epoch) return failure('Workspace changed during presentation');
    const epoch = value.epoch, signatureAtStart = value.signature;
    const turnId = context.turnId !== undefined ? context.turnId : value.state.turnId;
    const intent = value.state.userIntentVersion;
    const seq = ++value.seq, requestId = context.requestId || randomUUID();
    const results = [], resources = [];
    for (const [index, item] of normalized.items.entries()) {
      try {
        let resource;
        if (item.artifact_id) {
          const existing = value.resources.get(item.artifact_id);
          if (!existing) throw new Error('Resource does not belong to this session');
          // Revalidate file/provider references rather than trusting a stale record.
          resource = ['file', 'provider'].includes(existing.source.type)
            ? await resolveItem(getSessionRecord(id), existing.source.type === 'file' ? { ...item, path: existing.source.path } : { ...item, resource_uri: existing.source.uri }, context)
            : existing;
        } else resource = await resolveItem(getSessionRecord(id), item, context);
        if ((await session(id)) !== value || value.epoch !== epoch || value.signature !== signatureAtStart) throw new Error('Workspace changed during presentation');
        resource = { ...resource, title: item.title || resource.title, view: item.view, role: item.role, turnId, sourceToolUseId: context.toolUseId,
          schema: 'moss.artifact/v1', id: resource.id || 'artifact_' + hash(JSON.stringify([value.signature, sourceIdentity(resource.source)])), updatedAt: Date.now(), sequence: seq };
        const previous = value.resources.get(resource.id);
        resource.dirty = previous?.dirty || false;
        // Reading a file is navigation; only tool/adapter deliverables belong in Results.
        resource.isResult = Boolean(previous && previous.isResult !== false) || context.origin !== 'manual';
        if (context.fallback && previous) { resource.view = previous.view; resource.title = previous.title; }
        resource.bindings = [...(previous?.bindings || []).filter(binding => binding.turnId !== turnId || binding.sourceToolUseId !== context.toolUseId), { turnId, role: item.role, sourceToolUseId: context.toolUseId }].slice(-200);
        if (!previous || (previous.sequence || 0) <= seq) value.resources.set(resource.id, resource);
        resources.push(resource);
        results.push({ input_index: index, artifact_id: resource.id, revision: resource.revision, status: 'registered' });
      } catch (error) { results.push({ input_index: index, status: 'unavailable', error: failure(error).error }); }
    }
    if (value.epoch !== epoch) return failure('Workspace changed during presentation');
    if (!resources.length) return { ...failure('No resources are available'), schema: 'moss.presentation-result/v1', request_id: requestId, items: results, presentation: { state: 'unavailable', target: 'right' } };
    let chosen = resources.find(resource => resource.role === 'primary') || (resources.length === 1 ? resources[0] : null);
    if (!chosen) {
      const groupId = 'collection_' + hash(id + ':' + (turnId || requestId));
      const existing = value.resources.get(groupId);
      chosen = { schema: 'moss.artifact/v1', id: groupId, kind: 'collection', title: normalized.title || '本轮结果', revision: String(seq),
        source: { type: 'collection', memberIds: [...new Set([...(existing?.source.memberIds || []), ...resources.map(resource => resource.id)])] },
        capabilities: { preview: true, edit: false, popout: false }, availability: 'ready', persistence: 'durable', updatedAt: Date.now(), turnId, sequence: seq, isResult: context.origin !== 'manual' };
      if (!existing || (existing.sequence || 0) <= seq) value.resources.set(groupId, chosen);
      else value.resources.set(groupId, { ...existing, source: { ...existing.source, memberIds: chosen.source.memberIds } });
    }
    const previous = value.state;
    const latest = value.resources.get(chosen.id)?.sequence === seq;
    value.state = !latest ? previous : context.origin === 'manual' && normalized.mode !== 'background' && intent === previous.userIntentVersion
      ? transitionPresentation(previous, { type: 'select', id: chosen.id })
      : transitionPresentation(previous, { type: 'auto', id: chosen.id, seq, turnId, userIntentVersion: intent,
        mode: normalized.mode, foreground: foreground === id, fallback: context.fallback });
    const permitted = context.origin === 'manual' ? normalized.mode !== 'background' && intent === previous.userIntentVersion : normalized.mode !== 'background' && previous.autoFollow && !previous.pinnedId && !previous.dirty && !previous.manualHold && intent === previous.userIntentVersion && turnId === previous.turnId;
    const selected = latest && permitted && value.state.visible && value.state.activeId === chosen.id && foreground === id;
    const reason = normalized.mode === 'background' ? 'background' : foreground !== id ? 'background_session'
      : previous.pinnedId ? 'user_pinned' : previous.dirty ? 'unsaved_edits' : 'user_selection';
    const request = { requestId, sessionId: id, epoch, seq, turnId, artifactId: chosen.id, revision: chosen.revision, userIntentVersion: value.state.userIntentVersion };
    const result = { ok: true, schema: 'moss.presentation-result/v1', request_id: requestId, items: results,
      presentation: { state: selected ? 'pending' : 'deferred', ...(selected ? {} : { reason }), target: 'right' } };
    if (selected && chosen.source.type === 'app-view') result.presentation = { state: 'deferred', reason: 'open_workbench_entry', target: 'workbench' };
    value.results.set(requestId, result);
    while (value.results.size > 256) value.results.delete(value.results.keys().next().value);
    // Install before disk I/O: close/rebind/new requests must be able to cancel delivery.
    let completed;
    const acknowledged = new Promise(resolve => { completed = resolve; });
    deferRequests(value, 'superseded', pending => selected || !requestCurrent(value, pending));
    if (selected && chosen.source.type !== 'app-view') {
      waiters.set(id + ':' + requestId, { request, resolve: completed, result, updated: previous.visible && previous.activeId === chosen.id });
      value.request = request;
    }
    prune(value); await persist(value);
    await session(id);
    if (value.epoch !== epoch) return result;
    deferRequests(value, foreground !== id ? 'background_session' : 'superseded', pending => !requestCurrent(value, pending) || foreground !== id);
    notify(value, selected && chosen.source.type === 'app-view' && requestCurrent(value, request) && foreground === id ? request : undefined);
    if (value.request === request && waitMs > 0) {
      let timer;
      try { await Promise.race([acknowledged, new Promise(resolve => { timer = setTimeout(resolve, waitMs); })]); }
      finally { clearTimeout(timer); }
    }
    // Retain only a bounded set for late renderer acknowledgements.
    while (waiters.size > 256) waiters.delete(waiters.keys().next().value);
    return result;
  }
  return {
    async snapshot(id, { activate = false } = {}) {
      if (!id) { if (activate) foreground = null; return null; }
      const value = await session(id); if (activate) foreground = id;
      return snapshot(value);
    },
    async beginTurn(id, turnId) {
      const value = await session(id); value.state = transitionPresentation(value.state, { type: 'turn', turnId });
      deferRequests(value, 'turn_changed', request => !requestCurrent(value, request));
      await persist(value); notify(value);
      return { epoch: value.epoch };
    },
    async action(id, action) {
      const value = await session(id);
      if (!action || !['select', 'dismiss', 'close', 'back', 'pin', 'follow', 'dirty'].includes(action.type) || Object.keys(action).some(key => !['type', 'id', 'value'].includes(key))) throw new Error('Invalid presentation action');
      if (['pin', 'follow', 'dirty'].includes(action.type) && typeof action.value !== 'boolean') throw new Error('Invalid presentation value');
      if (['select', 'dismiss'].includes(action.type) && (typeof action.id !== 'string' || action.id.length > 128)) throw new Error('Invalid resource id');
      if (action.type === 'select' && !['workspace', 'browser', 'results'].includes(action.id) && !value.resources.has(action.id)) throw new Error('Resource is unavailable');
      if (action.type === 'dirty' && action.id) {
        const resource = value.resources.get(action.id);
        if (!resource) throw new Error('Resource is unavailable');
        resource.dirty = action.value;
        action = { ...action, value: [...value.resources.values()].some(resource => resource.dirty) };
      } else if (action.type === 'dirty') action = { ...action, value: action.value || [...value.resources.values()].some(resource => resource.dirty) };
      value.state = transitionPresentation(value.state, action);
      deferRequests(value, action.type === 'close' ? 'user_closed' : 'user_selection', request => !requestCurrent(value, request));
      await persist(value); notify(value); return snapshot(value);
    },
    async present(id, input, context = {}) {
      const value = await session(id);
      if (context.epoch && value.epoch !== context.epoch) return failure('Workspace changed during presentation');
      const key = context.requestId ? JSON.stringify([id, value.epoch, context.turnId, context.requestId]) : null;
      if (key && requests.has(key)) return requests.get(key);
      const pending = submit(id, input, { ...context, epoch: value.epoch }).catch(failure);
      if (key) { requests.set(key, pending); while (requests.size > 256) requests.delete(requests.keys().next().value); }
      return pending;
    },
    async register(id, resource, context = {}) {
      // Only trusted host adapters call this method; public input cannot create native sources.
      const value = await session(id);
      if (context.epoch && value.epoch !== context.epoch) return failure('Workspace changed during presentation');
      const artifactId = resource.id || 'artifact_' + hash(JSON.stringify([value.signature, sourceIdentity(resource.source)]));
      value.resources.set(artifactId, { ...value.resources.get(artifactId), ...resource, schema: 'moss.artifact/v1', id: artifactId, updatedAt: Date.now(), turnId: context.turnId });
      return this.present(id, { items: [{ artifact_id: artifactId, role: 'primary' }], mode: context.mode || 'auto' }, { ...context, epoch: value.epoch });
    },
    async load(id, artifactId) {
      const value = await session(id), resource = value.resources.get(artifactId), epoch = value.epoch;
      if (!resource || resource.availability === 'expired') throw new Error('Resource is unavailable or expired');
      if (['file', 'provider'].includes(resource.source.type)) {
        const current = await resolveItem(getSessionRecord(id), resource.source.type === 'file' ? { path: resource.source.path } : { resource_uri: resource.source.uri }, { origin: 'manual' });
        if (current.revision !== resource.revision) {
          if ((await session(id)).epoch !== epoch) throw new Error('Workspace changed while loading');
          value.resources.set(artifactId, { ...resource, ...current, location: resource.location, id: artifactId }); await persist(value); notify(value);
          throw new Error('文件已更新，正在重新读取');
        }
      }
      const file = await loadResource(getSessionRecord(id), resource);
      if ((await session(id)).epoch !== epoch || value.resources.get(artifactId)?.revision !== resource.revision) throw new Error('Resource changed while loading');
      return { resource, file, epoch };
    },
    async acknowledge(id, ack) {
      const value = await session(id), pending = waiters.get(id + ':' + ack.requestId);
      if (!pending || !['shown', 'error'].includes(ack.state)) return { accepted: false };
      const request = pending.request, resource = value.resources.get(request.artifactId);
      if (request.sessionId !== id || request.epoch !== value.epoch || ack.epoch !== value.epoch || ack.revision !== request.revision
        || resource?.revision !== request.revision || value.state.activeId !== request.artifactId || !value.state.visible
        || value.state.userIntentVersion !== request.userIntentVersion || request.turnId !== value.state.turnId || foreground !== id) return { accepted: false };
      pending.result.presentation = { state: ack.state === 'shown' && pending.updated ? 'updated' : ack.state, target: 'right', ...(ack.state === 'error' ? { reason: String(ack.error || 'Render failed').slice(0, 512) } : {}) };
      pending.resolve(); waiters.delete(id + ':' + ack.requestId);
      if (value.request === request) value.request = null;
      value.results.set(ack.requestId, pending.result); await persist(value);
      emit?.('presentation:result', { sessionId: id, result: pending.result });
      return { accepted: true };
    },
    async documentChanged(document) {
      for (const value of sessions.values()) {
        let changed = false;
        for (const resource of value.resources.values()) if (resource.source.type === 'file' && resource.source.path === document.path) { resource.dirty = document.dirty; changed = true; }
        if (changed) { value.state = transitionPresentation(value.state, { type: 'dirty', value: [...value.resources.values()].some(resource => resource.dirty) }); await persist(value); notify(value); }
      }
    },
    async refresh(id, { activeOnly = false } = {}) {
      const value = await session(id), epoch = value.epoch, refreshSeq = (value.refreshSeq || 0) + 1;
      if (activeOnly && (foreground !== id || !value.state.visible)) return snapshot(value);
      value.refreshSeq = refreshSeq;
      let changed = false;
      for (const [artifactId, resource] of value.resources) {
        if (!['file', 'provider'].includes(resource.source.type)) continue;
        if (activeOnly && (value.state.activeId !== artifactId || resource.source.type !== 'provider')) continue;
        try {
          const next = await resolveItem(getSessionRecord(id), resource.source.type === 'file' ? { path: resource.source.path } : { resource_uri: resource.source.uri }, { origin: 'manual' });
          if ((await session(id)).epoch !== epoch || value.refreshSeq !== refreshSeq) return;
          if (value.resources.get(artifactId) !== resource) continue;
          const updated = { ...resource, ...next, location: resource.location, title: resource.title, id: artifactId };
          if (JSON.stringify(updated) !== JSON.stringify(resource)) { value.resources.set(artifactId, updated); changed = true; }
        } catch { if ((await session(id)).epoch === epoch && value.refreshSeq === refreshSeq && value.resources.get(artifactId) === resource && resource.availability !== 'unavailable') { value.resources.set(artifactId, { ...resource, availability: 'unavailable' }); changed = true; } }
      }
      if (changed) { await persist(value); notify(value); }
      return snapshot(value);
    },
    async flush() { await Promise.all([...sessions.values()].map(value => value.writes)); },
  };
}
