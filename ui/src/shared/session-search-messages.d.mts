export type SearchableSessionMessage = {
  messageId: string;
  role: 'user' | 'assistant';
  body: string;
  timestamp: number;
};

export function getSearchMessageId(event: Record<string, any>): string;
export function extractSearchableSessionMessages(history: Array<Record<string, any>>): SearchableSessionMessage[];
