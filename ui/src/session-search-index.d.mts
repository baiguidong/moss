export { getSearchMessageId, extractSearchableSessionMessages } from './shared/session-search-messages.mjs';
export type { SearchableSessionMessage } from './shared/session-search-messages.mjs';
export function createSessionSearchIndex(db: any): {
  syncSession: (sessionRecord: Record<string, any>) => void;
  syncTitle: (sessionRecord: Record<string, any>) => void;
  hasSession: (sessionId: string) => boolean;
  deleteSession: (sessionId: string) => void;
  search: (
    query: string,
    options?: { sessionIds?: string[]; limit?: number },
  ) => Array<{
    sessionId: string;
    messageId: string | null;
    role: 'user' | 'assistant' | null;
    snippet: string;
    timestamp: number;
    rank: number;
  }>;
};
