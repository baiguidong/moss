import assert from 'node:assert/strict'
import { createAuthService } from '../auth/service.js'
import {
  AuthRepository,
  createSyntheticUserEmail,
  hashPassword,
} from '../model/repositories/auth.js'
import { openTestDatabase } from './databaseTestUtils.js'

const db = await openTestDatabase(':memory:')
const authDb = new AuthRepository(db)

try {
  const freshDb = await openTestDatabase(':memory:')
  const freshAuthDb = new AuthRepository(freshDb)
  try {
    const created = await freshAuthDb.bootstrap({ username: 'admin' })
    assert.equal(created.bootstrapAdminUsername, 'admin')
    assert.equal(created.bootstrapAdminPassword, 'password')
  } finally {
    await freshDb.close()
  }

  const timestamp = Date.now()
  await authDb.createOrganization('org-1', 'Existing Organization', timestamp)
  await authDb.createUser({
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
  await authDb.ensureBuiltinRoles('org-1')
  const userRole = await authDb.getRoleBySystemKey('org-1', 'user')
  assert.ok(userRole)
  await authDb.setRolePermissions(userRole.id, [
    'sessions:create',
    'directory:read',
    'im:use',
    'im:group:create',
  ])
  await authDb.setUserRoleIds('user-1', [userRole.id])
  await authDb.setConfig('jwt_secret', 'existing-secret')

  const { service, bootstrap } = await createAuthService({
    db,
    tokenTtlSec: 3600,
    bootstrapAdmin: { username: 'admin' },
  })

  assert.deepEqual(bootstrap, { created: false })
  assert.equal((await authDb.listUsersByName('admin')).length, 1)
  const upgradedUser = await service.getUserOrNull('user-1', 'org-1')
  assert.ok(upgradedUser?.effectiveScopes.includes('im:use'))
  assert.ok(upgradedUser?.effectiveScopes.includes('im:group:create'))
} finally {
  await db.close()
}
