import { describe, it, expect, beforeEach } from 'bun:test'
import { DatabaseSync } from 'node:sqlite'
import { McpStore } from '../db.js'
import { createMcpAdminApi } from '../../api/mcpAdmin.js'
import type { AuthContext } from '../../auth/token.js'
import type { McpServerInput, McpPolicyInput } from '../types.js'

function createTestApi() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON;')
  const store = new McpStore(db)
  store['createTables']()

  const api = createMcpAdminApi({
    mcpStore: store,
    authService: {
      requireScope: () => {},
    } as any,
    getUserName: (id: string) => `user-${id}`,
    getUserDepartmentId: (userId: string) => userId === 'dept-admin' ? 'dept-1' : null,
  })

  return { store, api }
}

const adminAuth: AuthContext = {
  rawToken: 'test',
  userId: 'admin-1',
  orgId: 'org-1',
  role: 'admin',
  scopes: ['*'],
  keyId: 'key-1',
  jti: 'jti-1',
  exp: Date.now() + 3600000,
}

const deptAdminAuth: AuthContext = {
  rawToken: 'test',
  userId: 'dept-admin',
  orgId: 'org-1',
  role: 'dept_admin',
  scopes: ['admin:mcp', 'admin:mcp:write', 'admin:mcp:audit'],
  keyId: 'key-1',
  jti: 'jti-2',
  exp: Date.now() + 3600000,
}

const baseInput: McpServerInput = {
  name: 'test-mcp',
  display_name: 'Test MCP',
  scope: 'org',
  owner_type: 'system',
  owner_id: 'org-1',
  mcp_type: 'http',
  url: 'https://mcp.example.com/sse',
}

describe('McpAdminApi', () => {
  let store: McpStore
  let api: ReturnType<typeof createMcpAdminApi>

  beforeEach(() => {
    const deps = createTestApi()
    store = deps.store
    api = deps.api
  })

  describe('listMcpServers', () => {
    it('lists servers for admin', () => {
      store.createMcpServer('org-1', baseInput, 'admin-1')
      store.createMcpServer('org-1', { ...baseInput, name: 'mcp-2' }, 'admin-1')

      const result = api.listMcpServers(adminAuth)
      expect(result.success).toBe(true)
      expect(result.data.length).toBe(2)
    })

    it('filters for dept_admin to only see own department and org servers', () => {
      store.createMcpServer('org-1', { ...baseInput, name: 'org-mcp', scope: 'org' }, 'admin-1')
      store.createMcpServer('org-1', { ...baseInput, name: 'dept-mcp', scope: 'department', owner_type: 'department', owner_id: 'dept-1' }, 'admin-1')
      store.createMcpServer('org-1', { ...baseInput, name: 'other-dept-mcp', scope: 'department', owner_type: 'department', owner_id: 'dept-2' }, 'admin-1')

      const result = api.listMcpServers(deptAdminAuth)
      expect(result.success).toBe(true)
      expect(result.data.length).toBe(2) // org + own dept
    })
  })

  describe('createMcpServer', () => {
    it('creates an MCP server as admin', () => {
      const result = api.createMcpServer(adminAuth, baseInput)
      expect(result.success).toBe(true)
      expect(result.data.name).toBe('test-mcp')
    })

    it('rejects duplicate name with 409', () => {
      api.createMcpServer(adminAuth, baseInput)
      expect(() => api.createMcpServer(adminAuth, baseInput)).toThrow(/已存在/)
    })

    it('allows dept_admin to create department MCP', () => {
      const deptInput: McpServerInput = {
        ...baseInput,
        scope: 'department',
        owner_type: 'department',
        owner_id: 'dept-1',
      }
      const result = api.createMcpServer(deptAdminAuth, deptInput)
      expect(result.success).toBe(true)
    })

    it('rejects dept_admin from creating org MCP', () => {
      expect(() => api.createMcpServer(deptAdminAuth, baseInput)).toThrow(/企业级/)
    })
  })

  describe('updateMcpServer', () => {
    it('updates a server', () => {
      const created = store.createMcpServer('org-1', baseInput, 'admin-1')
      const result = api.updateMcpServer(adminAuth, created.id, { display_name: 'Updated' })
      expect(result.success).toBe(true)
      expect(result.data.display_name).toBe('Updated')
    })

    it('returns 404 for non-existent server', () => {
      const result = api.updateMcpServer(adminAuth, 'non-existent', { display_name: 'Updated' })
      expect(result.success).toBe(false)
    })

    it('rejects duplicate name on update', () => {
      store.createMcpServer('org-1', baseInput, 'admin-1')
      const s2 = store.createMcpServer('org-1', { ...baseInput, name: 'mcp-2' }, 'admin-1')
      expect(() => api.updateMcpServer(adminAuth, s2.id, { name: 'test-mcp' })).toThrow(/已存在/)
    })
  })

  describe('deleteMcpServer', () => {
    it('deletes a server', () => {
      const created = store.createMcpServer('org-1', baseInput, 'admin-1')
      const result = api.deleteMcpServer(adminAuth, created.id)
      expect(result.success).toBe(true)
    })

    it('returns 404 for non-existent', () => {
      const result = api.deleteMcpServer(adminAuth, 'non-existent')
      expect(result.success).toBe(false)
    })
  })

  describe('setMcpServerEnabled', () => {
    it('toggles enabled state', () => {
      const created = store.createMcpServer('org-1', baseInput, 'admin-1')
      const disabled = api.setMcpServerEnabled(adminAuth, created.id, false)
      expect(disabled.success).toBe(true)
      expect(disabled.data.enabled).toBe(false)
    })
  })

  describe('getMcpPolicy', () => {
    it('returns default policy', () => {
      const result = api.getMcpPolicy(adminAuth)
      expect(result.success).toBe(true)
      expect(result.data.allow_personal_mcp).toBe(false)
    })
  })

  describe('updateMcpPolicy', () => {
    it('creates and updates policy', () => {
      const result = api.updateMcpPolicy(adminAuth, { allow_personal_mcp: true })
      expect(result.success).toBe(true)
      expect(result.data.allow_personal_mcp).toBe(true)
    })
  })

  describe('listApprovalRequests', () => {
    it('lists approval requests', () => {
      store.createApprovalRequest({ org_id: 'org-1', user_id: 'u1', user_name: 'User 1', mcp_server_id: 's1' })
      const result = api.listApprovalRequests(adminAuth)
      expect(result.success).toBe(true)
      expect(result.data.length).toBe(1)
    })
  })

  describe('approveRequest', () => {
    it('approves a pending request', () => {
      const server = store.createMcpServer('org-1', baseInput, 'admin-1')
      const req = store.createApprovalRequest({ org_id: 'org-1', user_id: 'u1', user_name: null, mcp_server_id: server.id })
      const result = api.approveRequest(adminAuth, req.id)
      expect(result.success).toBe(true)
      expect(result.data!.status).toBe('approved')
    })

    it('rejects already processed request', () => {
      const server = store.createMcpServer('org-1', baseInput, 'admin-1')
      const req = store.createApprovalRequest({ org_id: 'org-1', user_id: 'u1', user_name: null, mcp_server_id: server.id })
      api.approveRequest(adminAuth, req.id)
      const result = api.approveRequest(adminAuth, req.id)
      expect(result.success).toBe(false)
    })
  })

  describe('rejectRequest', () => {
    it('rejects with reason', () => {
      const server = store.createMcpServer('org-1', baseInput, 'admin-1')
      const req = store.createApprovalRequest({ org_id: 'org-1', user_id: 'u1', user_name: null, mcp_server_id: server.id })
      const result = api.rejectRequest(adminAuth, req.id, 'Security risk')
      expect(result.success).toBe(true)
      expect(result.data!.status).toBe('rejected')
      expect(result.data!.review_note).toBe('Security risk')
    })
  })
})
