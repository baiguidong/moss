import { describe, it, expect } from 'bun:test'
import { testMcpConnection } from '../testConnection.js'
import type { McpServer } from '../types.js'

function makeServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: 'test-id',
    org_id: 'org-1',
    name: 'test-mcp',
    display_name: 'Test MCP',
    description: null,
    icon: null,
    category: null,
    risk_level: 'low',
    responsible_person: null,
    scope: 'org',
    owner_type: 'system',
    owner_id: 'org-1',
    mcp_type: 'http',
    url: null,
    command: null,
    args_json: null,
    env_json: null,
    timeout_ms: 5000,
    health_check_url: null,
    use_proxy: false,
    auth_type: 'none',
    secret_ref: null,
    auth_config_json: null,
    visible_to: null,
    bound_assistants: null,
    bound_skills: null,
    allow_read: true,
    allow_write: true,
    require_confirmation_for_write: false,
    allow_read_sensitive_fields: false,
    allow_outbound_network: true,
    allow_scheduled_task: false,
    audit_request: false,
    audit_response_summary: false,
    redact_sensitive_fields: false,
    allow_user_disable: true,
    status: 'pending',
    enabled: true,
    last_invocation_at: null,
    created_by: 'admin-1',
    updated_by: null,
    created_at: Date.now(),
    updated_at: Date.now(),
    ...overrides,
  }
}

describe('testMcpConnection', () => {
  it('fails for HTTP with no URL', async () => {
    const server = makeServer({ mcp_type: 'http', url: null })
    const result = await testMcpConnection(server)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('URL')
  })

  it('fails for HTTP with unreachable URL', async () => {
    const server = makeServer({
      mcp_type: 'http',
      url: 'http://127.0.0.1:1/nonexistent',
      timeout_ms: 1000,
    })
    const result = await testMcpConnection(server)
    expect(result.ok).toBe(false)
  })

  it('fails for STDIO with no command', async () => {
    const server = makeServer({ mcp_type: 'stdio', command: null })
    const result = await testMcpConnection(server)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('命令')
  })

  it('succeeds for STDIO with valid command', async () => {
    const server = makeServer({
      mcp_type: 'stdio',
      command: 'echo',
      args_json: '["hello"]',
      timeout_ms: 5000,
    })
    const result = await testMcpConnection(server)
    expect(result.ok).toBe(true)
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })

  it('fails for STDIO with invalid command', async () => {
    const server = makeServer({
      mcp_type: 'stdio',
      command: '/nonexistent/command/that/does/not/exist',
      timeout_ms: 2000,
    })
    const result = await testMcpConnection(server)
    expect(result.ok).toBe(false)
  })

  it('returns latency_ms for all results', async () => {
    const server = makeServer({ mcp_type: 'http', url: null })
    const result = await testMcpConnection(server)
    expect(result.latency_ms).toBeGreaterThanOrEqual(0)
  })
})
