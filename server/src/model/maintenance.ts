import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'

/** The server and offline object-store verification must never run together. */
export async function acquireDatabaseOwner(
  rootDir: string,
): Promise<() => Promise<void>> {
  await mkdir(rootDir, { recursive: true })
  try {
    return await lockfile.lock(rootDir, {
      realpath: false,
      lockfilePath: join(rootDir, '.database-owner.lock'),
      stale: 30000,
      update: 10000,
      retries: 0,
    })
  } catch (error) {
    throw new Error(
      'Moss Server or a database maintenance command is already running; stop it before continuing',
      { cause: error },
    )
  }
}
