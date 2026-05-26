import { describe, it, expect, beforeEach } from 'bun:test'
import { DatabaseSync } from 'node:sqlite'
import { McpStore } from '../db.js'
import type { McpServerInput, McpPolicyInput } from '../types.js'

function createTestStore(): McpStore {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON;')
  const store = new McpStore(db)
  store['createTables']()
  return store
}

describe('McpStore', () => {
  let store: McpStore

  beforeEach(() => {
    store = createTestStore()
  })

  const orgId = 'org-1'
  const baseInput: McpServerInput = {
    name: 'test-mcp',
    display_name: 'Test MCP',
    description: 'A test MCP server',
    scope: 'org',
    owner_type: 'system',
    owner_id: 'org-1',
    mcp_type: 'http',
    url: 'https://mcp.example.com/sse',
    risk_level: 'low',
  }

  describe('MCP Server CRUD', () => {
    it('creates and retrieves an MCP server', () => {
      const server = store.createMcpServer(orgId, baseInput, 'user-1')
      expect(server.id).toBeTruthy()
      expect(server.name).toBe('test-mcp')
      expect(server.scope).toBe('org')
      expect(server.mcp_type).toBe('http')
      expect(server.enabled).toBe(true)
      expect(server.status).toBe('pending')

      const fetched = store.getMcpServer(orgId, server.id)
      expect(fetched).not.toBeNull()
      expect(fetched!.name).toBe('test-mcp')
    })

    it('lists MCP servers with pagination', () => {
      for (let i = 0; i < 25; i++) {
        store.createMcpServer(orgId, { ...baseInput, name: `mcp-${i}` }, 'user-1')
      }
      const page1 = store.listMcpServers(orgId, { page: 1, page_size: 10 })
      expect(page1.items.length).toBe(10)
      expect(page1.total).toBe(25)

      const page3 = store.listMcpServers(orgId, { page: 3, page_size: 10 })
      expect(page3.items.length).toBe(5)
    })

    it('filters by scope', () => {
      store.createMcpServer(orgId, { ...baseInput, name: 'org-mcp', scope: 'org' }, 'user-1')
      store.createMcpServer(orgId, { ...baseInput, name: 'dept-mcp', scope: 'department', owner_type: 'department', owner_id: 'dept-1' }, 'user-1')

      const orgOnly = store.listMcpServers(orgId, { scope: 'org' })
      expect(orgOnly.items.length).toBe(1)
      expect(orgOnly.items[0].scope).toBe('org')
    })

    it('filters by combined status (enabled/disabled)', () => {
      const s1 = store.createMcpServer(orgId, { ...baseInput, name: 'enabled-mcp' }, 'user-1')
      store.setMcpServerEnabled(orgId, s1.id, false, 'user-1')

      const disabled = store.listMcpServers(orgId, { status: 'disabled' })
      expect(disabled.items.length).toBe(1)
      expect(disabled.items[0].name).toBe('enabled-mcp')
    })

    it('filters by risk level', () => {
      store.createMcpServer(orgId, { ...baseInput, name: 'high-risk', risk_level: 'high' }, 'user-1')
      store.createMcpServer(orgId, { ...baseInput, name: 'low-risk', risk_level: 'low' }, 'user-1')

      const high = store.listMcpServers(orgId, { risk_level: 'high' })
      expect(high.items.length).toBe(1)
      expect(high.items[0].name).toBe('high-risk')
    })

    it('filters by mcp_type', () => {
      store.createMcpServer(orgId, { ...baseInput, name: 'http-mcp', mcp_type: 'http' }, 'user-1')
      store.createMcpServer(orgId, { ...baseInput, name: 'stdio-mcp', mcp_type: 'stdio', command: '/usr/bin/mcp' }, 'user-1')

      const stdio = store.listMcpServers(orgId, { mcp_type: 'stdio' })
      expect(stdio.items.length).toBe(1)
      expect(stdio.items[0].name).toBe('stdio-mcp')
    })

    it('filters by audit_enabled', () => {
      store.createMcpServer(orgId, { ...baseInput, name: 'audited-mcp', audit_request: true }, 'user-1')
      store.createMcpServer(orgId, { ...baseInput, name: 'no-audit-mcp' }, 'user-1')

      const audited = store.listMcpServers(orgId, { audit_enabled: true })
      expect(audited.items.length).toBe(1)
      expect(audited.items[0].name).toBe('audited-mcp')
    })

    it('updates an MCP server', () => {
      const server = store.createMcpServer(orgId, baseInput, 'user-1')
      const updated = store.updateMcpServer(orgId, server.id, { display_name: 'Updated Name', risk_level: 'high' }, 'user-2')
      expect(updated.display_name).toBe('Updated Name')
      expect(updated.risk_level).toBe('high')
      expect(updated.updated_by).toBe('user-2')
    })

    it('deletes an MCP server', () => {
      const server = store.createMcpServer(orgId, baseInput, 'user-1')
      const deleted = store.deleteMcpServer(orgId, server.id)
      expect(deleted).toBe(true)
      expect(store.getMcpServer(orgId, server.id)).toBeNull()
    })

    it('enables/disables an MCP server', () => {
      const server = store.createMcpServer(orgId, baseInput, 'user-1')
      const disabled = store.setMcpServerEnabled(orgId, server.id, false, 'user-1')
      expect(disabled!.enabled).toBe(false)

      const enabled = store.setMcpServerEnabled(orgId, server.id, true, 'user-1')
      expect(enabled!.enabled).toBe(true)
    })

    it('sets MCP server status', () => {
      const server = store.createMcpServer(orgId, baseInput, 'user-1')
      store.setMcpServerStatus(orgId, server.id, 'enabled', 'user-1')
      const fetched = store.getMcpServer(orgId, server.id)
      expect(fetched!.status).toBe('enabled')
    })

    it('enforces name uniqueness within org', () => {
      store.createMcpServer(orgId, baseInput, 'user-1')
      expect(() => {
        store.createMcpServer(orgId, baseInput, 'user-1')
      }).toThrow()
    })

    it('allows same name in different orgs', () => {
      store.createMcpServer(orgId, baseInput, 'user-1')
      const other = store.createMcpServer('org-2', baseInput, 'user-1')
      expect(other).toBeTruthy()
    })
  })

  describe('MCP Policy CRUD', () => {
    it('returns default policy when none exists', () => {
      const policy = store.getMcpPolicy(orgId)
      expect(policy.org_id).toBe(orgId)
      expect(policy.allow_personal_mcp).toBe(false)
      expect(policy.require_confirmation_for_high_risk).toBe(true)
    })

    it('creates and retrieves a policy', () => {
      const input: McpPolicyInput = {
        allow_personal_mcp: true,
        allow_stdio_mcp: true,
      }
      const policy = store.upsertMcpPolicy(orgId, input, 'user-1')
      expect(policy.allow_personal_mcp).toBe(true)
      expect(policy.allow_stdio_mcp).toBe(true)
      expect(policy.require_confirmation_for_high_risk).toBe(true) // unchanged default

      const fetched = store.getMcpPolicy(orgId)
      expect(fetched.allow_personal_mcp).toBe(true)
    })

    it('updates an existing policy', () => {
      store.upsertMcpPolicy(orgId, { allow_personal_mcp: true }, 'user-1')
      const updated = store.upsertMcpPolicy(orgId, { allow_personal_mcp: false, allow_stdio_mcp: true }, 'user-2')
      expect(updated.allow_personal_mcp).toBe(false)
      expect(updated.allow_stdio_mcp).toBe(true)
    })

    it('stores domain whitelist', () => {
      const policy = store.upsertMcpPolicy(orgId, { domain_whitelist_json: ['example.com', 'api.example.com'] }, 'user-1')
      expect(policy.domain_whitelist_json).toEqual(['example.com', 'api.example.com'])
    })
  })

  describe('MCP Audit Log', () => {
    it('inserts and queries audit logs', () => {
      store.insertAuditLog({
        org_id: orgId,
        mcp_server_id: 'server-1',
        mcp_server_name: 'test-mcp',
        user_id: 'user-1',
        user_name: 'Test User',
        action: 'create',
      })

      const result = store.queryAuditLog(orgId)
      expect(result.items.length).toBe(1)
      expect(result.items[0].action).toBe('create')
      expect(result.items[0].mcp_server_name).toBe('test-mcp')
    })

    it('filters audit logs by server', () => {
      store.insertAuditLog({ org_id: orgId, mcp_server_id: 's1', mcp_server_name: 'mcp1', user_id: 'u1', action: 'create' })
      store.insertAuditLog({ org_id: orgId, mcp_server_id: 's2', mcp_server_name: 'mcp2', user_id: 'u1', action: 'create' })

      const result = store.queryAuditLog(orgId, { mcp_server_id: 's1' })
      expect(result.items.length).toBe(1)
      expect(result.items[0].mcp_server_id).toBe('s1')
    })

    it('filters audit logs by action', () => {
      store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'create' })
      store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'test_connection' })

      const result = store.queryAuditLog(orgId, { action: 'test_connection' })
      expect(result.items.length).toBe(1)
    })

    it('paginates audit logs', () => {
      for (let i = 0; i < 30; i++) {
        store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: `action-${i}` })
      }
      const page1 = store.queryAuditLog(orgId, { page: 1, page_size: 10 })
      expect(page1.items.length).toBe(10)
      expect(page1.total).toBe(30)
    })
  })

  describe('MCP Approval Requests (Phase 2)', () => {
    it('creates and lists approval requests', () => {
      store.createApprovalRequest({ org_id: orgId, user_id: 'user-1', user_name: 'User 1', mcp_server_id: 'server-1' })

      const requests = store.listApprovalRequests(orgId)
      expect(requests.length).toBe(1)
      expect(requests[0].status).toBe('pending')
      expect(requests[0].user_name).toBe('User 1')
    })

    it('filters approval requests by status', () => {
      store.createApprovalRequest({ org_id: orgId, user_id: 'u1', user_name: null, mcp_server_id: 's1' })
      store.createApprovalRequest({ org_id: orgId, user_id: 'u2', user_name: null, mcp_server_id: 's2' })

      const pending = store.listApprovalRequests(orgId, 'pending')
      expect(pending.length).toBe(2)
    })

    it('approves a request', () => {
      const req = store.createApprovalRequest({ org_id: orgId, user_id: 'u1', user_name: null, mcp_server_id: 's1' })
      const updated = store.updateApprovalRequest(req.id, { status: 'approved', reviewed_by: 'admin-1', reviewer_name: 'Admin' })

      expect(updated!.status).toBe('approved')
      expect(updated!.reviewed_by).toBe('admin-1')
      expect(updated!.reviewer_name).toBe('Admin')
    })

    it('rejects a request with note', () => {
      const req = store.createApprovalRequest({ org_id: orgId, user_id: 'u1', user_name: null, mcp_server_id: 's1' })
      const updated = store.updateApprovalRequest(req.id, { status: 'rejected', reviewed_by: 'admin-1', review_note: 'Not allowed' })

      expect(updated!.status).toBe('rejected')
      expect(updated!.review_note).toBe('Not allowed')
    })
  })

  describe('listVisibleMcpServers', () => {
    it('returns only enabled servers', () => {
      store.createMcpServer(orgId, { ...baseInput, name: 'enabled-s' }, 'user-1')
      const disabled = store.createMcpServer(orgId, { ...baseInput, name: 'disabled-s' }, 'user-1')
      store.setMcpServerEnabled(orgId, disabled.id, false, 'user-1')

      const visible = store.listVisibleMcpServers(orgId, 'user-1', null)
      expect(visible.length).toBe(1)
      expect(visible[0].name).toBe('enabled-s')
    })
  })
})
