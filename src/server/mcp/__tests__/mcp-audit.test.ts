import { describe, it, expect, beforeEach } from 'bun:test'
import { DatabaseSync } from 'node:sqlite'
import { McpStore } from '../db.js'

function createTestStore(): McpStore {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON;')
  const store = new McpStore(db)
  store['createTables']()
  return store
}

describe('McpAuditLog', () => {
  let store: McpStore
  const orgId = 'org-1'

  beforeEach(() => {
    store = createTestStore()
  })

  it('inserts a basic audit log entry', () => {
    store.insertAuditLog({
      org_id: orgId,
      mcp_server_id: 'server-1',
      mcp_server_name: 'Test MCP',
      user_id: 'user-1',
      user_name: 'Test User',
      action: 'create',
    })

    const result = store.queryAuditLog(orgId)
    expect(result.items.length).toBe(1)
    const entry = result.items[0]
    expect(entry.action).toBe('create')
    expect(entry.mcp_server_id).toBe('server-1')
    expect(entry.mcp_server_name).toBe('Test MCP')
    expect(entry.user_id).toBe('user-1')
    expect(entry.user_name).toBe('Test User')
  })

  it('inserts entry with all optional fields', () => {
    store.insertAuditLog({
      org_id: orgId,
      mcp_server_id: 's1',
      mcp_server_name: 'MCP1',
      session_id: 'sess-1',
      user_id: 'user-1',
      user_name: 'User',
      action: 'tool_call',
      tool_name: 'search',
      request_params_json: '{"query":"test"}',
      response_summary: 'Found 5 results',
      status: 'success',
      ip_address: '192.168.1.1',
    })

    const result = store.queryAuditLog(orgId)
    const entry = result.items[0]
    expect(entry.session_id).toBe('sess-1')
    expect(entry.tool_name).toBe('search')
    expect(entry.request_params_json).toBe('{"query":"test"}')
    expect(entry.response_summary).toBe('Found 5 results')
    expect(entry.status).toBe('success')
    expect(entry.ip_address).toBe('192.168.1.1')
  })

  it('inserts error entries', () => {
    store.insertAuditLog({
      org_id: orgId,
      mcp_server_id: 's1',
      mcp_server_name: 'MCP1',
      user_id: 'user-1',
      action: 'test_connection',
      status: 'error',
      error_message: 'Connection timeout',
    })

    const result = store.queryAuditLog(orgId)
    expect(result.items[0].status).toBe('error')
    expect(result.items[0].error_message).toBe('Connection timeout')
  })

  it('filters by mcp_server_id', () => {
    store.insertAuditLog({ org_id: orgId, mcp_server_id: 's1', mcp_server_name: 'MCP1', user_id: 'u1', action: 'create' })
    store.insertAuditLog({ org_id: orgId, mcp_server_id: 's2', mcp_server_name: 'MCP2', user_id: 'u1', action: 'create' })
    store.insertAuditLog({ org_id: orgId, mcp_server_id: 's1', mcp_server_name: 'MCP1', user_id: 'u1', action: 'update' })

    const result = store.queryAuditLog(orgId, { mcp_server_id: 's1' })
    expect(result.items.length).toBe(2)
  })

  it('filters by user_id', () => {
    store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'create' })
    store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u2', action: 'create' })

    const result = store.queryAuditLog(orgId, { user_id: 'u1' })
    expect(result.items.length).toBe(1)
  })

  it('filters by action', () => {
    store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'create' })
    store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'test_connection' })
    store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'delete' })

    const result = store.queryAuditLog(orgId, { action: 'test_connection' })
    expect(result.items.length).toBe(1)
  })

  it('filters by time range', () => {
    const now = Date.now()
    store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'old' })

    const result = store.queryAuditLog(orgId, { since: now + 1000 })
    expect(result.items.length).toBe(0)

    const allResult = store.queryAuditLog(orgId, { since: 0 })
    expect(allResult.items.length).toBe(1)
  })

  it('paginates results correctly', () => {
    for (let i = 0; i < 50; i++) {
      store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: `action-${i}` })
    }

    const page1 = store.queryAuditLog(orgId, { page: 1, page_size: 20 })
    expect(page1.items.length).toBe(20)
    expect(page1.total).toBe(50)

    const page3 = store.queryAuditLog(orgId, { page: 3, page_size: 20 })
    expect(page3.items.length).toBe(10)
  })

  it('returns results in descending time order', () => {
    store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'first' })
    store.insertAuditLog({ org_id: orgId, mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'second' })

    const result = store.queryAuditLog(orgId)
    expect(result.items[0].action).toBe('second') // most recent first
    expect(result.items[1].action).toBe('first')
  })

  it('isolates by org_id', () => {
    store.insertAuditLog({ org_id: 'org-1', mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'create' })
    store.insertAuditLog({ org_id: 'org-2', mcp_server_id: null, mcp_server_name: null, user_id: 'u1', action: 'create' })

    const result = store.queryAuditLog('org-1')
    expect(result.items.length).toBe(1)
  })

  it('handles server deletion gracefully (ON DELETE SET NULL)', () => {
    // Create a server
    const server = store.createMcpServer(orgId, {
      name: 'test-mcp', scope: 'org', owner_type: 'system', owner_id: 'org-1', mcp_type: 'http',
    }, 'admin-1')

    // Insert audit log referencing the server
    store.insertAuditLog({
      org_id: orgId, mcp_server_id: server.id, mcp_server_name: 'test-mcp',
      user_id: 'u1', action: 'create',
    })

    // Delete the server
    store.deleteMcpServer(orgId, server.id)

    // Audit log should still exist with name preserved
    const result = store.queryAuditLog(orgId)
    expect(result.items.length).toBe(1)
    expect(result.items[0].mcp_server_id).toBeNull() // FK set null
    expect(result.items[0].mcp_server_name).toBe('test-mcp') // name preserved
  })
})
