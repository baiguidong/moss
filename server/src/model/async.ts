/** Sequential collection operations for business rules that read persistence. */
export async function mapAsync<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => R | Promise<R>,
): Promise<R[]> {
  const result: R[] = []
  for (let i = 0; i < items.length; i++) result.push(await fn(items[i]!, i))
  return result
}
export async function filterAsync<T>(
  items: readonly T[],
  fn: (item: T, index: number) => unknown | Promise<unknown>,
): Promise<T[]> {
  const result: T[] = []
  for (let i = 0; i < items.length; i++)
    if (await fn(items[i]!, i)) result.push(items[i]!)
  return result
}
export async function findAsync<T>(
  items: readonly T[],
  fn: (item: T, index: number) => unknown | Promise<unknown>,
): Promise<T | undefined> {
  for (let i = 0; i < items.length; i++)
    if (await fn(items[i]!, i)) return items[i]
  return undefined
}
export async function someAsync<T>(
  items: readonly T[],
  fn: (item: T, index: number) => unknown | Promise<unknown>,
): Promise<boolean> {
  for (let i = 0; i < items.length; i++) if (await fn(items[i]!, i)) return true
  return false
}
export async function everyAsync<T>(
  items: readonly T[],
  fn: (item: T, index: number) => unknown | Promise<unknown>,
): Promise<boolean> {
  for (let i = 0; i < items.length; i++)
    if (!(await fn(items[i]!, i))) return false
  return true
}
export async function forEachAsync<T>(
  items: readonly T[],
  fn: (item: T, index: number) => unknown | Promise<unknown>,
): Promise<void> {
  for (let i = 0; i < items.length; i++) await fn(items[i]!, i)
}
export async function flatMapAsync<T, R>(
  items: readonly T[],
  fn: (item: T, index: number) => R[] | Promise<R[]>,
): Promise<R[]> {
  return (await mapAsync(items, fn)).flat()
}
