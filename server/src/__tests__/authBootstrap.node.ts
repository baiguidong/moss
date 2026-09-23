import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createAuthService } from '../auth/service.js'
import { AuthCenterDb, createSyntheticUserEmail, hashPassword } from '../authCenter/db.js'

const db = new DatabaseSync(':memory:')
const authDb = new AuthCenterDb(db)

try {
  const freshDb = new DatabaseSync(':memory:')
  const freshAuthDb = new AuthCenterDb(freshDb)
  try {
    const created = freshAuthDb.bootstrap({ username: 'admin' })
    assert.equal(created.bootstrapAdminUsername, 'admin')
    assert.equal(created.bootstrapAdminPassword, 'password')
  } finally {
    freshDb.close()
  }

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
  authDb.ensureBuiltinRoles('org-1')
  const userRole = authDb.getRoleBySystemKey('org-1', 'user')
  assert.ok(userRole)
  authDb.setRolePermissions(userRole.id, ['sessions:create', 'directory:read'])
  authDb.setUserRoleIds('user-1', [userRole.id])
  authDb.setConfig('jwt_secret', 'existing-secret')

  const { service, bootstrap } = await createAuthService({
    db,
    dbPath: ':memory:',
    tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'admin' },
  })

  assert.deepEqual(bootstrap, { created: false })
  assert.equal(authDb.listUsersByName('admin').length, 1)
  const upgradedUser = service.getUserOrNull('user-1', 'org-1')
  assert.ok(upgradedUser?.effectiveScopes.includes('im:use'))
  assert.ok(upgradedUser?.effectiveScopes.includes('im:group:create'))
} finally {
  db.close()
}
