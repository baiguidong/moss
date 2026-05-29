import { describe, it, expect, beforeEach } from 'bun:test'
import { DatabaseSync } from 'node:sqlite'
import { McpStore } from '../db.js'
import { createMcpUserApi } from '../../api/mcpUser.js'
import type { AuthContext } from '../../auth/token.js'
import type { McpServerInput } from '../types.js'

function createTestApi() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON;')
  const store = new McpStore(db)
  store['createTables']()

  const api = createMcpUserApi({
    mcpStore: store,
    authService: {
      requireScope: () => {},
    } as any,
    getUserName: (id: string) => `user-${id}`,
    getUserDepartmentId: (userId: string) => userId === 'user-1' ? 'dept-1' : null,
    getUserByIdAndOrg: (userId: string, orgId: string) => {
      if (userId === 'user-1') return { role: 'user', departmentId: 'dept-1' }
      return { role: 'user', departmentId: null }
    },
    listDepartmentsByOrg: () => [{ id: 'dept-1', parentId: null }],
  })

  return { store, api }
}

const userAuth: AuthContext = {
  rawToken: 'test',
  userId: 'user-1',
  orgId: 'org-1',
  role: 'user',
  scopes: ['sessions:create'],
  keyId: 'key-1',
  jti: 'jti-1',
  exp: Date.now() + 3600000,
}

const orgServerInput: McpServerInput = {
  name: 'org-mcp',
  display_name: 'Org MCP',
  scope: 'org',
  owner_type: 'system',
  owner_id: 'org-1',
  mcp_type: 'http',
  url: 'https://mcp.example.com/sse',
}

describe('McpUserApi', () => {
  let store: McpStore
  let api: ReturnType<typeof createMcpUserApi>

  beforeEach(() => {
    const deps = createTestApi()
    store = deps.store
    api = deps.api
  })

  describe('listMyMcpServers', () => {
    it('returns org-level MCP servers visible to all', async () => {
      store.createMcpServer('org-1', orgServerInput, 'admin-1')
      // Set status to enabled for visibility
      const server = store.getMcpServerByName('org-1', 'org-mcp')!
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      const result = await api.listMyMcpServers(userAuth)
      expect(result.success).toBe(true)
      expect(result.data.length).toBe(1)
    })

    it('excludes sensitive fields from response', async () => {
      store.createMcpServer('org-1', { ...orgServerInput, env_json: '{"KEY":"value"}', secret_ref: 'system:myref' }, 'admin-1')
      const server = store.getMcpServerByName('org-1', 'org-mcp')!
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      const result = await api.listMyMcpServers(userAuth)
      expect(result.success).toBe(true)
      const data = result.data[0] as any
      expect(data.env_json).toBeUndefined()
      expect(data.secret_ref).toBeUndefined()
      expect(data.command).toBeUndefined()
    })

    it('filters by visibility', async () => {
      // Org MCP restricted to dept-2 only
      store.createMcpServer('org-1', {
        ...orgServerInput,
        name: 'restricted-mcp',
        visible_to: { department_ids: ['dept-2'] },
      }, 'admin-1')
      const server = store.getMcpServerByName('org-1', 'restricted-mcp')!
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      const result = await api.listMyMcpServers(userAuth)
      expect(result.success).toBe(true)
      expect(result.data.length).toBe(0) // user-1 is in dept-1, not dept-2
    })

    it('excludes disabled servers', async () => {
      const server = store.createMcpServer('org-1', orgServerInput, 'admin-1')
      store.setMcpServerEnabled('org-1', server.id, false, 'admin-1')

      const result = await api.listMyMcpServers(userAuth)
      expect(result.success).toBe(true)
      expect(result.data.length).toBe(0)
    })
  })

  describe('createPersonalMcp (Phase 2)', () => {
    it('rejects creation when policy disallows personal MCP', async () => {
      const result = await api.createPersonalMcp(userAuth, {
        name: 'my-mcp',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-1',
        mcp_type: 'http',
        url: 'https://my-mcp.example.com',
      })
      expect(result.success).toBe(false)
      expect((result as any).error.code).toBe('forbidden')
    })

    it('creates personal MCP when policy allows', async () => {
      store.upsertMcpPolicy('org-1', { allow_personal_mcp: true, allow_http_sse_mcp: true }, 'admin-1')

      const result = await api.createPersonalMcp(userAuth, {
        name: 'my-mcp',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-1',
        mcp_type: 'http',
        url: 'https://my-mcp.example.com',
      })
      expect(result.success).toBe(true)
    })

    it('creates approval request when policy requires it', async () => {
      store.upsertMcpPolicy('org-1', {
        allow_personal_mcp: true,
        allow_http_sse_mcp: true,
        require_approval: true,
      }, 'admin-1')

      const result = await api.createPersonalMcp(userAuth, {
        name: 'my-mcp',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-1',
        mcp_type: 'http',
        url: 'https://my-mcp.example.com',
      })
      expect(result.success).toBe(true)
      expect((result.data as any)._requires_approval).toBe(true)
    })
  })

  describe('updatePersonalMcp (Phase 2)', () => {
    it('updates own personal MCP', async () => {
      store.upsertMcpPolicy('org-1', { allow_personal_mcp: true, allow_http_sse_mcp: true }, 'admin-1')
      const created = await api.createPersonalMcp(userAuth, {
        name: 'my-mcp',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-1',
        mcp_type: 'http',
        url: 'https://my-mcp.example.com',
      })

      const result = await api.updatePersonalMcp(userAuth, (created.data as any).id, { display_name: 'My Updated MCP' })
      expect(result.success).toBe(true)
      expect((result.data as any).display_name).toBe('My Updated MCP')
    })

    it('rejects updating other user MCP', async () => {
      store.createMcpServer('org-1', {
        ...orgServerInput,
        name: 'other-user-mcp',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-2',
      }, 'user-2')

      const server = store.getMcpServerByName('org-1', 'other-user-mcp')!
      const result = await api.updatePersonalMcp(userAuth, server.id, { display_name: 'Hacked' })
      expect(result.success).toBe(false)
    })
  })

  describe('deletePersonalMcp (Phase 2)', () => {
    it('deletes own personal MCP', async () => {
      store.upsertMcpPolicy('org-1', { allow_personal_mcp: true, allow_http_sse_mcp: true }, 'admin-1')
      const created = await api.createPersonalMcp(userAuth, {
        name: 'my-mcp',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-1',
        mcp_type: 'http',
        url: 'https://my-mcp.example.com',
      })

      const result = await api.deletePersonalMcp(userAuth, (created.data as any).id)
      expect(result.success).toBe(true)
    })
  })

  describe('enableUserMcp / disableUserMcp', () => {
    /** Helper: create an org-level MCP with status='enabled' and optionally set allow_user_disable */
    function setupOrgMcp(opts?: { allow_user_disable?: boolean }) {
      const server = store.createMcpServer('org-1', {
        ...orgServerInput,
        allow_user_disable: opts?.allow_user_disable ?? true,
      }, 'admin-1')
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)
      return server
    }

    it('disables an org MCP for user', async () => {
      const server = setupOrgMcp()
      const result = await api.disableUserMcp(userAuth, server.id)
      expect(result.success).toBe(true)
    })

    it('enables a previously disabled org MCP', async () => {
      const server = setupOrgMcp()
      await api.disableUserMcp(userAuth, server.id)
      const result = await api.enableUserMcp(userAuth, server.id)
      expect(result.success).toBe(true)
    })

    it('rejects disable when allow_user_disable=false', async () => {
      const server = setupOrgMcp({ allow_user_disable: false })
      const result = await api.disableUserMcp(userAuth, server.id)
      expect(result.success).toBe(false)
      expect((result as any).error.code).toBe('forbidden')
    })

    it('rejects enable when allow_user_disable=false', async () => {
      const server = setupOrgMcp({ allow_user_disable: false })
      const result = await api.enableUserMcp(userAuth, server.id)
      expect(result.success).toBe(false)
      expect((result as any).error.code).toBe('forbidden')
    })

    it('disables a department MCP visible to user', async () => {
      const server = store.createMcpServer('org-1', {
        ...orgServerInput,
        name: 'dept-mcp',
        scope: 'department',
        owner_type: 'department',
        owner_id: 'dept-1',
        visible_to: { department_ids: ['dept-1'] },
      }, 'admin-1')
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      const result = await api.disableUserMcp(userAuth, server.id)
      expect(result.success).toBe(true)
    })

    it('disables a personal MCP without allow_user_disable check', async () => {
      store.upsertMcpPolicy('org-1', { allow_personal_mcp: true, allow_http_sse_mcp: true }, 'admin-1')
      const created = await api.createPersonalMcp(userAuth, {
        name: 'my-mcp',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-1',
        mcp_type: 'http',
        url: 'https://my-mcp.example.com',
      })
      const serverId = (created.data as any).id

      const result = await api.disableUserMcp(userAuth, serverId)
      expect(result.success).toBe(true)
    })

    it('enables a personal MCP', async () => {
      store.upsertMcpPolicy('org-1', { allow_personal_mcp: true, allow_http_sse_mcp: true }, 'admin-1')
      const created = await api.createPersonalMcp(userAuth, {
        name: 'my-mcp2',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-1',
        mcp_type: 'http',
        url: 'https://my-mcp.example.com',
      })
      const serverId = (created.data as any).id

      await api.disableUserMcp(userAuth, serverId)
      const result = await api.enableUserMcp(userAuth, serverId)
      expect(result.success).toBe(true)
    })

    it('rejects disable for admin-disabled MCP', async () => {
      const server = setupOrgMcp()
      store.setMcpServerEnabled('org-1', server.id, false, 'admin-1')
      const result = await api.disableUserMcp(userAuth, server.id)
      expect(result.success).toBe(false)
      expect((result as any).error.code).toBe('forbidden')
    })

    it('rejects enable for admin-disabled MCP', async () => {
      const server = setupOrgMcp()
      store.setMcpServerEnabled('org-1', server.id, false, 'admin-1')
      const result = await api.enableUserMcp(userAuth, server.id)
      expect(result.success).toBe(false)
      expect((result as any).error.code).toBe('forbidden')
    })

    it('rejects disable for another user personal MCP', async () => {
      const server = store.createMcpServer('org-1', {
        ...orgServerInput,
        name: 'other-mcp',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-2',
        visible_to: { user_ids: ['user-2'] },
      }, 'user-2')
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      const result = await api.disableUserMcp(userAuth, server.id)
      expect(result.success).toBe(false)
      expect((result as any).error.code).toBe('forbidden')
    })

    it('rejects enable for another user personal MCP', async () => {
      const server = store.createMcpServer('org-1', {
        ...orgServerInput,
        name: 'other-mcp2',
        scope: 'user',
        owner_type: 'user',
        owner_id: 'user-2',
        visible_to: { user_ids: ['user-2'] },
      }, 'user-2')
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      const result = await api.enableUserMcp(userAuth, server.id)
      expect(result.success).toBe(false)
      expect((result as any).error.code).toBe('forbidden')
    })

    it('returns not_found for non-existent MCP', async () => {
      const result = await api.disableUserMcp(userAuth, 'nonexistent')
      expect(result.success).toBe(false)
      expect((result as any).error.code).toBe('not_found')
    })

    it('disable is idempotent', async () => {
      const server = setupOrgMcp({ allow_user_disable: true })
      const r1 = await api.disableUserMcp(userAuth, server.id)
      const r2 = await api.disableUserMcp(userAuth, server.id)
      expect(r1.success).toBe(true)
      expect(r2.success).toBe(true)
    })

    it('enable is idempotent', async () => {
      const server = setupOrgMcp({ allow_user_disable: true })
      const result = await api.enableUserMcp(userAuth, server.id)
      expect(result.success).toBe(true)
    })
  })

  describe('listMyMcpServers with user_disabled', () => {
    it('returns user_disabled=false when no records exist', async () => {
      store.createMcpServer('org-1', orgServerInput, 'admin-1')
      const server = store.getMcpServerByName('org-1', 'org-mcp')!
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      const result = await api.listMyMcpServers(userAuth)
      expect(result.success).toBe(true)
      expect((result.data as any[]).length).toBe(1)
      expect((result.data as any[])[0].user_disabled).toBe(false)
    })

    it('returns user_disabled=true after user disables', async () => {
      store.createMcpServer('org-1', orgServerInput, 'admin-1')
      const server = store.getMcpServerByName('org-1', 'org-mcp')!
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      await api.disableUserMcp(userAuth, server.id)

      const result = await api.listMyMcpServers(userAuth)
      expect(result.success).toBe(true)
      expect((result.data as any[]).length).toBe(1)
      expect((result.data as any[])[0].user_disabled).toBe(true)
    })

    it('returns user_disabled=false after user re-enables', async () => {
      store.createMcpServer('org-1', orgServerInput, 'admin-1')
      const server = store.getMcpServerByName('org-1', 'org-mcp')!
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      await api.disableUserMcp(userAuth, server.id)
      await api.enableUserMcp(userAuth, server.id)

      const result = await api.listMyMcpServers(userAuth)
      expect(result.success).toBe(true)
      expect((result.data as any[])[0].user_disabled).toBe(false)
    })

    it('other user disable records do not affect current user', async () => {
      store.createMcpServer('org-1', orgServerInput, 'admin-1')
      const server = store.getMcpServerByName('org-1', 'org-mcp')!
      store.setMcpServerStatus('org-1', server.id, 'enabled', null)

      // Another user disables the same MCP
      store.addUserDisabledMcp('org-1', 'user-2', server.id)

      const result = await api.listMyMcpServers(userAuth)
      expect(result.success).toBe(true)
      expect((result.data as any[])[0].user_disabled).toBe(false)
    })
  })
})
