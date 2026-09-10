import {
  createLibraryResourceUri,
  parseLibraryResourceUri,
} from './library-service.mjs';

function text(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function limit(value, fallback, maximum) {
  return Math.min(maximum, Math.max(1, Number(value) || fallback));
}

function offset(value) {
  return Math.min(100_000, Math.max(0, Number(value) || 0));
}

function accessFor(scope, projectId) {
  const requested = ['current', 'personal', 'project'].includes(scope) ? scope : 'current';
  if (requested === 'project') {
    if (!projectId) throw new Error('A project Library scope is unavailable in this session.');
    return { projectOnlyId: projectId };
  }
  if (requested === 'personal' || !projectId) return { personalOnly: true };
  return { projectId };
}

function collectionIdFor(service, collection, access) {
  const target = text(collection);
  if (!target) return null;
  const normalized = target.toLocaleLowerCase('en-US');
  const match = service.listCollections(access).find((entry) => (
    entry.id === target || entry.name.toLocaleLowerCase('en-US') === normalized
  ));
  if (!match) throw new Error('Library Collection not found in the current scope.');
  return match.id;
}

function collectionItem(entry) {
  return {
    id: entry.id,
    uri: entry.uri,
    name: entry.name,
    description: entry.description,
    sourceCount: entry.sourceCount,
    resourceCount: entry.resourceCount,
  };
}

function sourceItem(entry) {
  return {
    id: entry.id,
    uri: entry.uri,
    name: entry.name,
    providerKind: entry.providerKind,
    status: entry.status,
    resourceCount: entry.resourceCount,
    readyCount: entry.readyCount,
    errorCount: entry.errorCount,
  };
}

function resourceItem(entry) {
  return {
    resourceId: entry.id,
    uri: createLibraryResourceUri(
      entry.id,
      entry.indexedRevision || entry.revision || '',
      entry.title,
    ),
    title: entry.title,
    extension: entry.extension,
    status: entry.status,
    revision: entry.revision,
    indexedRevision: entry.indexedRevision,
    sourceId: entry.sourceId,
    sourceName: entry.sourceName,
  };
}

function searchItem(entry) {
  const citation = {
    uri: entry.uri,
    resourceId: entry.resourceId,
    title: entry.title,
    source: entry.sourceName,
    page: entry.page,
    heading: entry.heading,
    chunkIndex: entry.chunkIndex,
    startLine: entry.startLine,
    endLine: entry.endLine,
    locationKind: entry.locationKind,
  };
  return {
    chunkId: entry.chunkId,
    chunkIndex: entry.chunkIndex,
    heading: entry.heading,
    page: entry.page,
    content: entry.context || entry.content,
    matchedContent: entry.content,
    contextChunkIndexes: entry.contextChunkIndexes,
    resourceId: entry.resourceId,
    uri: entry.uri,
    title: entry.title,
    extension: entry.extension,
    revision: entry.revision,
    sourceId: entry.sourceId,
    sourceName: entry.sourceName,
    score: entry.score,
    rank: entry.rank,
    citation,
    snippet: entry.snippet,
  };
}

function readResource(service, input, access) {
  const raw = text(input.resource);
  if (!raw) throw new Error('resource is required.');
  const reference = raw.startsWith('moss-library://')
    ? parseLibraryResourceUri(raw)
    : { resourceId: raw, revision: null };
  const resource = service.getResource({
    resourceId: reference.resourceId,
    chunkOffset: offset(input.offset),
    chunkLimit: limit(input.limit, 12, 50),
    ...access,
  });
  if (!['ready', 'stale'].includes(resource.status)) {
    throw new Error('Library resource is not indexed.');
  }
  if (reference.revision && reference.revision !== resource.indexedRevision) {
    throw new Error('The indexed Library resource changed since this reference was created.');
  }
  const uri = createLibraryResourceUri(
    resource.id,
    resource.indexedRevision || resource.revision || '',
    resource.title,
  );
  return {
    resourceId: resource.id,
    uri,
    title: resource.title,
    extension: resource.extension,
    status: resource.status,
    revision: resource.revision,
    indexedRevision: resource.indexedRevision,
    sourceName: resource.sourceName,
    chunks: resource.chunks.map((chunk) => ({
      chunkIndex: chunk.index,
      blockIndex: chunk.blockIndex,
      heading: chunk.heading,
      page: chunk.page,
      startLine: chunk.startLine,
      endLine: chunk.endLine,
      locationKind: chunk.locationKind,
      content: chunk.content,
    })),
    nextOffset: resource.nextOffset,
  };
}

export async function handleLibraryAgentToolEvent({
  event,
  libraryService,
  enabled = true,
  projectId = '',
  sessionId = '',
}) {
  if (!['library_list', 'library_search', 'library_read', 'library_write'].includes(event?.type)) return null;
  if (!enabled) return { ok: false, error: 'Moss Library is disabled in Settings.' };
  if (!libraryService) return { ok: false, error: 'Moss Library is unavailable.' };
  try {
    const input = event.input && typeof event.input === 'object' ? event.input : {};
    if (event.type === 'library_write') {
      const collectionId = collectionIdFor(libraryService, input.collection, { personalOnly: true });
      if (!collectionId) throw new Error('collection is required.');
      if (!text(sessionId)) throw new Error('当前会话不能写入资料库。');
      const result = await libraryService.writeFilesToCollection({
        sessionId: text(sessionId),
        collectionId,
        files: input.files,
        sourceName: input.sourceName,
      });
      return { ok: true, libraryWrite: result };
    }
    const access = accessFor(input.scope, text(projectId));
    if (event.type === 'library_list') {
      const kind = ['collections', 'sources', 'resources'].includes(input.kind)
        ? input.kind
        : 'collections';
      const collectionId = collectionIdFor(libraryService, input.collection, access);
      const start = offset(input.offset);
      const count = limit(input.limit, 50, 200);
      if (kind === 'collections') {
        return {
          ok: true,
          items: libraryService.listCollections(access).slice(start, start + count).map(collectionItem),
        };
      }
      if (kind === 'sources') {
        return {
          ok: true,
          items: libraryService.listSources({ collectionId, ...access })
            .slice(start, start + count)
            .map(sourceItem),
        };
      }
      return {
        ok: true,
        items: libraryService.listResources({ collectionId, limit: count, offset: start, ...access })
          .map(resourceItem),
      };
    }
    if (event.type === 'library_search') {
      const query = text(input.query);
      if (!query) throw new Error('query is required.');
      const collectionId = collectionIdFor(libraryService, input.collection, access);
      return {
        ok: true,
        items: libraryService.search({
          query,
          collectionId,
          sourceId: text(input.sourceId) || undefined,
          mode: ['all', 'any'].includes(input.mode) ? input.mode : 'auto',
          includeContext: true,
          limit: limit(input.limit, 12, 50),
          ...access,
        }).map(searchItem),
      };
    }
    return { ok: true, resource: readResource(libraryService, input, access) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
