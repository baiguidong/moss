import { describe, it, expect, beforeEach } from 'bun:test'
import { DatabaseSync } from 'node:sqlite'
import { McpStore } from '../db.js'
import type { McpPolicyInput } from '../types.js'

function createTestStore(): McpStore {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys=ON;')
  const store = new McpStore(db)
  store['createTables']()
  return store
}

describe('McpPolicy', () => {
  let store: McpStore
  const orgId = 'org-1'

  beforeEach(() => {
    store = createTestStore()
  })

  it('returns correct defaults for new org', () => {
    const policy = store.getMcpPolicy(orgId)
    expect(policy.allow_personal_mcp).toBe(false)
    expect(policy.allow_stdio_mcp).toBe(false)
    expect(policy.allow_http_sse_mcp).toBe(false)
    expect(policy.allow_local_file_access).toBe(false)
    expect(policy.allow_external_network).toBe(false)
    expect(policy.domain_whitelist_json).toBeNull()
    expect(policy.require_approval).toBe(false)
    expect(policy.allow_auto_task_call_personal_mcp).toBe(false)
    expect(policy.allow_enterprise_assistant_call_personal_mcp).toBe(false)
    expect(policy.allow_enterprise_context_in_personal_mcp).toBe(false)

    expect(policy.require_confirmation_for_high_risk).toBe(true)
    expect(policy.require_confirmation_for_write).toBe(true)
    expect(policy.audit_request_params).toBe(false)
    expect(policy.audit_response_summary).toBe(false)
    expect(policy.redact_audit_logs).toBe(false)
    expect(policy.limit_concurrency_and_rate).toBe(false)
    expect(policy.restrict_callable_models).toBe(false)
  })

  it('creates a policy from partial input', () => {
    const input: McpPolicyInput = { allow_personal_mcp: true }
    const policy = store.upsertMcpPolicy(orgId, input, 'admin-1')
    expect(policy.allow_personal_mcp).toBe(true)
    // Other fields should have defaults
    expect(policy.require_confirmation_for_high_risk).toBe(true)
  })

  it('updates only specified fields', () => {
    store.upsertMcpPolicy(orgId, { allow_personal_mcp: true }, 'admin-1')
    store.upsertMcpPolicy(orgId, { allow_stdio_mcp: true }, 'admin-2')
    const policy = store.getMcpPolicy(orgId)
    expect(policy.allow_personal_mcp).toBe(true) // unchanged
    expect(policy.allow_stdio_mcp).toBe(true) // updated
    expect(policy.updated_by).toBe('admin-2')
  })

  it('stores and retrieves domain whitelist', () => {
    const domains = ['example.com', '*.example.org', 'api.test.com']
    store.upsertMcpPolicy(orgId, { domain_whitelist_json: domains }, 'admin-1')
    const policy = store.getMcpPolicy(orgId)
    expect(policy.domain_whitelist_json).toEqual(domains)
  })

  it('clears domain whitelist by setting null', () => {
    store.upsertMcpPolicy(orgId, { domain_whitelist_json: ['a.com'] }, 'admin-1')
    store.upsertMcpPolicy(orgId, { domain_whitelist_json: null }, 'admin-1')
    const policy = store.getMcpPolicy(orgId)
    expect(policy.domain_whitelist_json).toBeNull()
  })

  it('updates security policy fields', () => {
    const input: McpPolicyInput = {
      require_confirmation_for_high_risk: false,
      require_confirmation_for_write: false,
      audit_request_params: true,
      audit_response_summary: true,
      redact_audit_logs: true,
      limit_concurrency_and_rate: true,
      restrict_callable_models: true,
    }
    const policy = store.upsertMcpPolicy(orgId, input, 'admin-1')
    expect(policy.require_confirmation_for_high_risk).toBe(false)
    expect(policy.require_confirmation_for_write).toBe(false)
    expect(policy.audit_request_params).toBe(true)
    expect(policy.audit_response_summary).toBe(true)
    expect(policy.redact_audit_logs).toBe(true)
    expect(policy.limit_concurrency_and_rate).toBe(true)
    expect(policy.restrict_callable_models).toBe(true)
  })

  it('enforces org_id uniqueness (one policy per org)', () => {
    store.upsertMcpPolicy(orgId, { allow_personal_mcp: true }, 'admin-1')
    // Upsert again should update, not create duplicate
    store.upsertMcpPolicy(orgId, { allow_stdio_mcp: true }, 'admin-1')
    const policy = store.getMcpPolicy(orgId)
    expect(policy.allow_personal_mcp).toBe(true)
    expect(policy.allow_stdio_mcp).toBe(true)
  })

  it('different orgs have independent policies', () => {
    store.upsertMcpPolicy('org-1', { allow_personal_mcp: true }, 'admin-1')
    store.upsertMcpPolicy('org-2', { allow_personal_mcp: false }, 'admin-1')

    const p1 = store.getMcpPolicy('org-1')
    const p2 = store.getMcpPolicy('org-2')
    expect(p1.allow_personal_mcp).toBe(true)
    expect(p2.allow_personal_mcp).toBe(false)
  })
})
