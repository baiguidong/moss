import { z } from 'zod/v4'
import {
  buildTool,
  getGlobalAppEventBridge,
  type MossAppEvent,
  type MossAppEventResult,
  type ToolDef,
  type ToolUseContext,
} from '../../Tool.js'
import { jsonStringify } from '../../utils/slowOperations.js'
import {
  LIBRARY_LIST_TOOL_NAME,
  LIBRARY_READ_TOOL_NAME,
  LIBRARY_SEARCH_TOOL_NAME,
  LIBRARY_WRITE_TOOL_NAME,
} from './constants.js'

const scopeSchema = z.enum(['current', 'personal', 'project'])
const itemSchema = z.record(z.string(), z.unknown())

const listInputSchema = z.strictObject({
  kind: z.enum(['collections', 'sources', 'resources']).optional(),
  collection: z.string().optional().describe('Optional Collection id or exact name.'),
  scope: scopeSchema.optional().describe('Defaults to personal plus the current project.'),
  limit: z.number().int().min(1).max(200).optional(),
  offset: z.number().int().min(0).max(100_000).optional(),
})

const searchInputSchema = z.strictObject({
  query: z.string().min(1).describe('Text to search for in indexed Library content.'),
  collection: z.string().optional().describe('Optional Collection id or exact name.'),
  sourceId: z.string().optional(),
  scope: scopeSchema.optional().describe('Defaults to personal plus the current project.'),
  mode: z.enum(['auto', 'all', 'any']).optional().describe('Defaults to automatic strict search with a bounded broad fallback.'),
  limit: z.number().int().min(1).max(50).optional(),
})

const readInputSchema = z.strictObject({
  resource: z.string().min(1).describe('Resource id or moss-library:// resource URI.'),
  offset: z.number().int().min(0).max(100_000).optional(),
  limit: z.number().int().min(1).max(50).optional(),
})

const writeFileSchema = z.strictObject({
  path: z.string().min(1).describe('File path relative to, or inside, the current session workspace.'),
  categoryKey: z.enum(['work', 'study', 'finance', 'records', 'life', 'creative', 'reference', 'other']).optional(),
  subcategory: z.string().max(24).optional(),
  reason: z.string().max(180).optional().describe('Concise reason why this file belongs in the Library.'),
})

const writeInputSchema = z.strictObject({
  collection: z.string().min(1).describe('Target personal Collection id or exact name.'),
  files: z.array(writeFileSchema).min(1),
  sourceName: z.string().max(80).optional(),
})

const listOutputSchema = z.object({
  ok: z.boolean(),
  items: z.array(itemSchema).optional(),
  error: z.string().optional(),
})

const readOutputSchema = z.object({
  ok: z.boolean(),
  resource: itemSchema.optional(),
  error: z.string().optional(),
})

const writeOutputSchema = z.object({
  ok: z.boolean(),
  sourceId: z.string().optional(),
  collectionName: z.string().optional(),
  written: z.array(itemSchema).optional(),
  failed: z.array(itemSchema).optional(),
  jobId: z.string().optional(),
  error: z.string().optional(),
})

type ListInput = z.infer<typeof listInputSchema>
type SearchInput = z.infer<typeof searchInputSchema>
type ReadInput = z.infer<typeof readInputSchema>
type WriteInput = z.infer<typeof writeInputSchema>
type ListOutput = z.infer<typeof listOutputSchema>
type ReadOutput = z.infer<typeof readOutputSchema>
type WriteOutput = z.infer<typeof writeOutputSchema>

async function emitLibraryEvent(
  event: MossAppEvent,
  context: ToolUseContext,
): Promise<MossAppEventResult> {
  const emitAppEvent = context.emitAppEvent ?? getGlobalAppEventBridge()
  if (!emitAppEvent) {
    return { ok: false, error: 'Moss Library is unavailable because its desktop bridge is not connected.' }
  }
  return emitAppEvent(event)
}

function mapResult(content: ListOutput | ReadOutput | WriteOutput, toolUseID: string) {
  return {
    tool_use_id: toolUseID,
    type: 'tool_result' as const,
    content: jsonStringify(content),
  }
}

export const LibraryListTool = buildTool({
  name: LIBRARY_LIST_TOOL_NAME,
  requiresDesktop: true,
  searchHint: 'list local Library collections sources and resources',
  maxResultSizeChars: 100_000,
  async description() {
    return 'List Collections, Sources, or Resources from the user\'s Moss Library without exposing source filesystem paths.'
  },
  async prompt() {
    return 'Use library_list to discover Moss Library Collections, Sources, and Resources. The default current scope includes personal content and the current project only.'
  },
  get inputSchema() {
    return listInputSchema
  },
  get outputSchema() {
    return listOutputSchema
  },
  userFacingName() {
    return 'Library List'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isSearchOrReadCommand() {
    return { isSearch: false, isRead: false, isList: true }
  },
  async call(input: ListInput, context: ToolUseContext): Promise<{ data: ListOutput }> {
    const result = await emitLibraryEvent({ type: 'library_list', input }, context)
    return result.ok
      ? { data: { ok: true, items: result.items ?? [] } }
      : { data: { ok: false, error: result.error } }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<typeof listInputSchema, ListOutput>)

export const LibrarySearchTool = buildTool({
  name: LIBRARY_SEARCH_TOOL_NAME,
  requiresDesktop: true,
  searchHint: 'search indexed local knowledge and evidence',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Search indexed Moss Library content and return evidence with stable resource citations.'
  },
  async prompt() {
    return 'Use library_search for questions about the user\'s Library. Keep the default auto mode. If the first search has no useful result, retry at most twice with focused synonyms, an expanded acronym, or a shorter business term; keep the same scope and do not issue broad unrelated queries.'
  },
  get inputSchema() {
    return searchInputSchema
  },
  get outputSchema() {
    return listOutputSchema
  },
  userFacingName() {
    return 'Library Search'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isSearchOrReadCommand() {
    return { isSearch: true, isRead: false }
  },
  async call(input: SearchInput, context: ToolUseContext): Promise<{ data: ListOutput }> {
    const result = await emitLibraryEvent({ type: 'library_search', input }, context)
    return result.ok
      ? { data: { ok: true, items: result.items ?? [] } }
      : { data: { ok: false, error: result.error } }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<typeof searchInputSchema, ListOutput>)

export const LibraryReadTool = buildTool({
  name: LIBRARY_READ_TOOL_NAME,
  requiresDesktop: true,
  searchHint: 'read indexed chunks from a Library resource',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Read indexed chunks from one Moss Library Resource by resource id or stable moss-library URI.'
  },
  async prompt() {
    return 'Use library_read after library_search when more context is needed. Preserve the returned URI, title, source, location kind, page or slide, line or paragraph range, heading, and chunk index in citations.'
  },
  get inputSchema() {
    return readInputSchema
  },
  get outputSchema() {
    return readOutputSchema
  },
  userFacingName() {
    return 'Library Read'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  isSearchOrReadCommand() {
    return { isSearch: false, isRead: true }
  },
  async call(input: ReadInput, context: ToolUseContext): Promise<{ data: ReadOutput }> {
    const result = await emitLibraryEvent({ type: 'library_read', input }, context)
    return result.ok
      ? { data: { ok: true, resource: result.resource as Record<string, unknown> } }
      : { data: { ok: false, error: result.error } }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<typeof readInputSchema, ReadOutput>)

export const LibraryWriteTool = buildTool({
  name: LIBRARY_WRITE_TOOL_NAME,
  requiresDesktop: true,
  supportedEnvironments: ['desktop'],
  searchHint: 'add selected workspace files to a personal Library collection',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Copy selected files from the current local session workspace into a personal Moss Library Collection and start indexing them.'
  },
  async prompt() {
    return 'Use library_write only after the user has confirmed which files should be added. Pass paths inside the current session workspace, the exact target Collection, and a useful category for every file. Unsupported files are returned as per-file failures.'
  },
  get inputSchema() {
    return writeInputSchema
  },
  get outputSchema() {
    return writeOutputSchema
  },
  userFacingName() {
    return 'Library Write'
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isSearchOrReadCommand() {
    return { isSearch: false, isRead: false }
  },
  async call(input: WriteInput, context: ToolUseContext): Promise<{ data: WriteOutput }> {
    const result = await emitLibraryEvent({ type: 'library_write', input }, context)
    if (!result.ok) return { data: { ok: false, error: result.error } }
    const writeResult = result.libraryWrite as {
      sourceId?: string
      collectionName?: string
      written?: Array<Record<string, unknown>>
      failed?: Array<Record<string, unknown>>
      job?: { id?: string }
    } | undefined
    return {
      data: {
        ok: true,
        sourceId: writeResult?.sourceId,
        collectionName: writeResult?.collectionName,
        written: writeResult?.written ?? [],
        failed: writeResult?.failed ?? [],
        jobId: writeResult?.job?.id,
      },
    }
  },
  mapToolResultToToolResultBlockParam: mapResult,
} satisfies ToolDef<typeof writeInputSchema, WriteOutput>)

export const LibraryTools = [LibraryListTool, LibrarySearchTool, LibraryReadTool, LibraryWriteTool] as const
