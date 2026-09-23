import { expect, test } from 'bun:test'
import { Readable } from 'node:stream'
import type { AuthContext } from '../auth/token.js'
import { CloudStorageService } from '../cloudStorage/service.js'
import type { CloudStorageRepository } from '../model/repositories/cloudStorage.js'
import type { ServerConfig } from '../types.js'

test('a failed file lookup releases upload slots and allows cancellation and shutdown', async () => {
  const unavailable = new Error('Database temporarily unavailable')
  const repository = {
    getOwnedUpload: async () => ({ id: 'upload', fileId: 'file', state: 'uploading', expiresAt: Date.now() + 60000, size: 12, partSize: 4 }),
    getOwnedFile: async () => { throw unavailable },
  } as unknown as CloudStorageRepository
  const service = new CloudStorageService(repository, { cloudStorage: { enabled: false } } as unknown as ServerConfig, async () => {})
  const auth: AuthContext = { rawToken: 'token', orgId: 'org', userId: 'user', keyId: 'key', role: 'user', scopes: ['cloud-storage:write'] }
  const leases: Array<ReturnType<typeof service.acquire>> = []
  const acquire = service.acquire.bind(service)
  // Retain leases solely for teardown if a regression prevents normal release.
  service.acquire = (...args) => { const lease = acquire(...args); leases.push(lease); return lease }
  try {
    for (let number = 1; number <= 3; number++) {
      const source = Readable.from(Buffer.from('file'))
      try { await expect(service.part(auth, 'upload', number, 4, source)).rejects.toBe(unavailable) }
      finally { source.destroy() }
    }
    expect(await service.exclusive('upload', async () => 'available')).toBe('available')
    const next = service.acquire(auth, 'new-upload:1', 'write')
    next.release()
    await service.close()
  } finally {
    for (const lease of leases) lease.release()
    await service.close()
  }
})
