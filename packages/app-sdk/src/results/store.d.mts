import type { ResultTransfer } from './index.mjs'
export function createResultTransport(options?: { now?: () => number }): {
  pack<T>(value: T): { value?: T; transfer?: ResultTransfer };
  read(input: { id: string; offset: number }): { data: string; nextOffset: number; done: boolean };
  release(id: string): { released: boolean }; close(): void;
}
export function readUtf16Range(file: string, offset?: number, limit?: number): { text: string; nextOffset: number | null }
