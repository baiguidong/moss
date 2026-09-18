export type SearchableSessionMessage = {
  messageId: string;
  role: 'user' | 'assistant';
  body: string;
  timestamp: number;
};

export function getSearchMessageId(event: Record<string, any>): string;
export function extractSearchableSessionMessages(history: Array<Record<string, any>>): SearchableSessionMessage[];
export function createSessionSearchIndex(db: any): {
  syncSession: (sessionRecord: Record<string, any>) => void;
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
