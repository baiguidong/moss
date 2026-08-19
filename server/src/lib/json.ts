import { readFile } from 'fs/promises'

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isENOENT(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

export function jsonParse(input: string): unknown {
  return JSON.parse(input)
}

export function jsonStringify(input: unknown): string {
  return JSON.stringify(input)
}

export async function readJSONLFile<T>(filePath: string): Promise<T[]> {
  const raw = await readFile(filePath, 'utf8')
  return raw
    .split('\n')
    .filter(line => line.trim().length > 0)
    .map(line => JSON.parse(line) as T)
}
