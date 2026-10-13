export type CompactionEntry = {
  id: string;
  kind: 'summary' | 'preserved' | 'attachment' | 'hook';
  role: string;
  content: unknown;
};
export type CompactionRecord = {
  id: string;
  number: number;
  trigger?: string;
  preTokens?: number;
  entries: CompactionEntry[];
  complete: boolean;
};

export function buildCompactionRecords(history: readonly any[]) {
  const records = new Map<string, CompactionRecord>();
  let last: CompactionRecord | undefined;
  for (const [index, event] of history.entries()) {
    if (!event || typeof event !== "object") continue;
    if (event.isSidechain || event.parent_tool_use_id != null) continue;
    if (event.type === 'system' && event.subtype === 'compact_boundary') {
      const id = event.uuid || event.id || `compact-${index}`;
      const metadata = event.compactMetadata ?? event.compact_metadata ?? {};
      const complete = metadata.context?.version === 1 && Array.isArray(metadata.context.entries);
      last = { id, number: records.get(id)?.number ?? records.size + 1, trigger: metadata.trigger,
        preTokens: metadata.preTokens ?? metadata.pre_tokens,
        entries: complete ? metadata.context.entries : records.get(id)?.entries ?? [], complete };
      records.set(id, last);
    } else if (last && !last.complete && event.type === 'user' && event.isCompactSummary) {
      if (!last.entries.some(entry => entry.id === event.uuid)) last.entries.push({
        id: event.uuid, kind: 'summary', role: 'user', content: event.message?.content ?? '',
      });
    }
  }
  return records;
}

export function contextEntryText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content) && content.every(block => block?.type === 'text')) {
    return content.map(block => block.text).join('\n\n');
  }
  return JSON.stringify(content, null, 2) ?? '';
}
