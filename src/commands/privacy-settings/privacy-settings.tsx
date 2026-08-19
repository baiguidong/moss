import type { ReactNode } from 'react'
import type { LocalJSXCommandOnDone } from '../../types/command.js';

export async function call(
  onDone: LocalJSXCommandOnDone,
): Promise<ReactNode | null> {
  onDone('Privacy settings are not supported in this build.')
  return null
}
