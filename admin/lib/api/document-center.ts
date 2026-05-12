import { authClient } from './client'

// ============================================================
// Document Center API types — mirror server-side DocumentStore types
// (camelCase here; server returns same shape from documentStore.ts).
// ============================================================

export type DocumentTreeNode = {
  id: string
  orgId: string
  parentId: string | null
  name: string
  description: string | null
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export type DocumentRecord = {
  id: string
  orgId: string
  nodeId: string
  fileName: string
  mimeType: string
  sizeBytes: number
  storagePath: string
  uploadedBy: string
  uploadedAt: number
}

export type WikiBuildStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export type WikiRecord = {
  id: string
  orgId: string
  nodeId: string | null
  name: string
  description: string | null
  storagePath: string
  buildStatus: WikiBuildStatus
  sourceDocumentIds: string[]
  lastBuiltAt: number | null
  lastBuildError: string | null
  createdBy: string
  createdAt: number
  updatedAt: number
}

export type WikiBuildJob = {
  id: string
  wikiId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  currentStep: string | null
  errorMessage: string | null
  sessionId: string | null
  triggeredBy: string
  queuedAt: number
  startedAt: number | null
  finishedAt: number | null
}

// ============================================================
// Tree
// ============================================================

export async function getDocumentTree(): Promise<DocumentTreeNode[]> {
  const data = await authClient.get<{ nodes: DocumentTreeNode[] }>('/api/v1/documents/tree')
  return data.nodes
}

export function createDocumentTreeNode(input: {
  parent_id: string | null
  name: string
  description?: string
  sort_order?: number
}): Promise<DocumentTreeNode> {
  return authClient.post<DocumentTreeNode>('/api/v1/documents/tree/nodes', input)
}

export function updateDocumentTreeNode(
  id: string,
  input: {
    parent_id?: string | null
    name?: string
    description?: string | null
    sort_order?: number
  },
): Promise<DocumentTreeNode> {
  return authClient.patch<DocumentTreeNode>(`/api/v1/documents/tree/nodes/${id}`, input)
}

export function deleteDocumentTreeNode(id: string): Promise<{ ok: boolean }> {
  return authClient.delete(`/api/v1/documents/tree/nodes/${id}`)
}

// ============================================================
// Documents (uploads)
// ============================================================

export async function listDocumentsForNode(nodeId: string): Promise<DocumentRecord[]> {
  const data = await authClient.get<{ documents: DocumentRecord[] }>(
    `/api/v1/documents/tree/nodes/${nodeId}/documents`,
  )
  return data.documents
}

export function uploadDocument(nodeId: string, input: {
  file_name: string
  mime_type: string
  content_base64: string
}): Promise<DocumentRecord> {
  return authClient.post<DocumentRecord>(
    `/api/v1/documents/tree/nodes/${nodeId}/documents`,
    input,
  )
}

export function deleteDocument(docId: string): Promise<{ ok: boolean }> {
  return authClient.delete(`/api/v1/documents/${docId}`)
}

/**
 * Read a File as a base64 string (without `data:...;base64,` prefix).
 */
export async function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result === 'string') {
        // Strip "data:<mime>;base64," prefix
        const commaIdx = result.indexOf(',')
        resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result)
      } else {
        reject(new Error('FileReader did not return a string'))
      }
    }
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'))
    reader.readAsDataURL(file)
  })
}

// ============================================================
// Wikis
// ============================================================

export async function listWikis(filter?: {
  node_id?: string
  build_status?: WikiBuildStatus
}): Promise<WikiRecord[]> {
  const params = new URLSearchParams()
  if (filter?.node_id) params.set('node_id', filter.node_id)
  if (filter?.build_status) params.set('build_status', filter.build_status)
  const qs = params.toString()
  const data = await authClient.get<{ wikis: WikiRecord[] }>(
    `/api/v1/wikis${qs ? `?${qs}` : ''}`,
  )
  return data.wikis
}

export function getWiki(id: string): Promise<WikiRecord> {
  return authClient.get<WikiRecord>(`/api/v1/wikis/${id}`)
}

export function createWiki(input: {
  name: string
  description?: string
  node_id?: string | null
  source_document_ids: string[]
}): Promise<WikiRecord> {
  return authClient.post<WikiRecord>('/api/v1/wikis', input)
}

export function updateWiki(
  id: string,
  input: {
    name?: string
    description?: string | null
    node_id?: string | null
    source_document_ids?: string[]
  },
): Promise<WikiRecord> {
  return authClient.patch<WikiRecord>(`/api/v1/wikis/${id}`, input)
}

export function deleteWiki(id: string): Promise<{ ok: boolean }> {
  return authClient.delete(`/api/v1/wikis/${id}`)
}

export function triggerWikiBuild(id: string): Promise<{ job_id: string; wiki_id: string }> {
  return authClient.post<{ job_id: string; wiki_id: string }>(
    `/api/v1/wikis/${id}/build`,
    undefined,
  )
}

export function getWikiBuildStatus(id: string): Promise<{
  wiki_build_status: WikiBuildStatus
  last_built_at: number | null
  last_build_error: string | null
  latest_job: WikiBuildJob | null
}> {
  return authClient.get(`/api/v1/wikis/${id}/build-status`)
}

/**
 * Subscribe to live build progress via SSE.
 *
 * Returns an unsubscribe function. The caller is responsible for handling
 * fall-back to polling if EventSource is unavailable (very old browsers).
 */
export function subscribeWikiBuildEvents(
  id: string,
  handlers: {
    onProgress?: (data: {
      wiki_build_status: WikiBuildStatus | 'unknown'
      last_built_at: number | null
      last_build_error: string | null
      latest_job: WikiBuildJob | null
    }) => void
    onDone?: (data: unknown) => void
    onError?: (err: Event) => void
  },
): () => void {
  // EventSource doesn't support custom headers — token has to ride along
  // as a query param. The server falls back to its standard auth path
  // when a Bearer header is missing. (We rely on cookies via
  // `credentials: 'include'` semantics provided by same-origin EventSource.)
  // For cross-origin we currently degrade to one-shot poll; deemed
  // acceptable for P0 since AdminHub is served by moss-server itself.
  const url = `/api/v1/wikis/${encodeURIComponent(id)}/build-events`
  let es: EventSource | null
  try {
    es = new EventSource(url, { withCredentials: true })
  } catch {
    return () => undefined
  }
  if (handlers.onProgress) {
    es.addEventListener('progress', (e: MessageEvent) => {
      try {
        handlers.onProgress?.(JSON.parse(e.data))
      } catch {
        // ignore
      }
    })
  }
  if (handlers.onDone) {
    es.addEventListener('done', (e: MessageEvent) => {
      try {
        handlers.onDone?.(JSON.parse(e.data))
      } catch {
        handlers.onDone?.(null)
      }
      es?.close()
    })
  }
  if (handlers.onError) {
    es.onerror = handlers.onError
  }
  return () => {
    es?.close()
  }
}
