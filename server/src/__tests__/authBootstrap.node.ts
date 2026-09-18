import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createAuthService } from '../auth/service.js'
import { AuthCenterDb, createSyntheticUserEmail, hashPassword } from '../authCenter/db.js'

const db = new DatabaseSync(':memory:')
const authDb = new AuthCenterDb(db)

try {
  const timestamp = Date.now()
  authDb.createOrganization('org-1', 'Existing Organization', timestamp)
  authDb.createUser({
    id: 'user-1',
    orgId: 'org-1',
    email: createSyntheticUserEmail('user-1'),
    name: 'admin',
    departmentId: null,
    role: 'user',
    status: 'active',
    tokenLimit: null,
    createdAt: timestamp,
    passwordHash: hashPassword('existing-password'),
    passwordUpdatedAt: timestamp,
    lastLoginAt: null,
  })
  authDb.setConfig('jwt_secret', 'existing-secret')

  const { bootstrap } = await createAuthService({
    db,
    dbPath: ':memory:',
    tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'admin' },
  })

  assert.deepEqual(bootstrap, { created: false })
  assert.equal(authDb.listUsersByName('admin').length, 1)
} finally {
  db.close()
}
