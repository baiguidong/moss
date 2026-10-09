export const RESULT_LIMITS: Readonly<{ maxBytes: number; chunkBytes: number; pendingBytes: number; leaseMs: number }>
export interface ResultTransfer { id: string; size: number; encoding?: 'base64'; offsetUnit?: 'byte'; expiresAt?: number }
export function readJsonResult<T>(result: { value?: T; transfer?: ResultTransfer }, options: {
  read(input: { id: string; offset: number }, options: { signal?: AbortSignal }): Promise<{ data: string; nextOffset: number; done: boolean }>;
  release(id: string): Promise<unknown>; signal?: AbortSignal; maxBytes?: number;
}): Promise<T>

export function readJsonRanges<T = unknown>(read: (input: { offset: number; limit: number }, options: { signal?: AbortSignal }) => Promise<{ text: string; nextOffset: number | null }>, options?: { signal?: AbortSignal; maxBytes?: number }): Promise<T>
