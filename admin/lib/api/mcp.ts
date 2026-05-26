import { authClient } from './client'

// ===== Types =====

export interface McpServer {
  id: string
  org_id: string
  name: string
  display_name: string | null
  description: string | null
  icon: string | null
  category: string | null
  risk_level: 'low' | 'medium' | 'high'
  responsible_person: string | null
  scope: 'org' | 'department' | 'user'
  owner_type: 'system' | 'department' | 'user'
  owner_id: string
  mcp_type: 'http' | 'sse' | 'stdio'
  url: string | null
  command: string | null
  args_json: string | null
  env_json: string | null
  timeout_ms: number
  health_check_url: string | null
  use_proxy: boolean
  auth_type: 'none' | 'api_key' | 'bearer' | 'basic' | 'oauth' | 'custom_header' | 'secret_ref'
  secret_ref: string | null
  auth_config_json: string | null
  visible_to: { department_ids?: string[]; user_ids?: string[] } | null
  bound_assistants: string[] | null
  bound_skills: string[] | null
  allow_read: boolean
  allow_write: boolean
  require_confirmation_for_write: boolean
  allow_read_sensitive_fields: boolean
  allow_outbound_network: boolean
  allow_scheduled_task: boolean
  audit_request: boolean
  audit_response_summary: boolean
  redact_sensitive_fields: boolean
  allow_user_disable: boolean
  enabled: boolean
  status: 'enabled' | 'pending' | 'error'
  created_by: string
  created_at: number
  updated_at: number
}

export interface McpPolicy {
  allow_personal_mcp: boolean
  allow_stdio_mcp: boolean
  allow_http_sse_mcp: boolean
  allow_local_file_access: boolean
  allow_external_network: boolean
  domain_whitelist_json: string
  require_approval: boolean
  allow_auto_task_call_personal_mcp: boolean
  allow_enterprise_assistant_call_personal_mcp: boolean
  allow_enterprise_context_in_personal_mcp: boolean
  require_confirmation_for_high_risk: boolean
  require_confirmation_for_write: boolean
  audit_request_params: boolean
  audit_response_summary: boolean
  redact_audit_logs: boolean
  limit_concurrency_and_rate: boolean
  restrict_callable_models: boolean
}

export interface McpAuditLog {
  id: string
  org_id: string
  mcp_server_id: string | null
  mcp_server_name: string | null
  action: string
  tool_name: string | null
  user_id: string
  user_name: string | null
  session_id: string | null
  status: 'success' | 'failure'
  request_params_json: string | null
  response_summary: string | null
  error_message: string | null
  created_at: number
}

export type McpServerFormData = Partial<Omit<McpServer, 'id' | 'org_id' | 'created_by' | 'created_at' | 'updated_at' | 'status' | 'last_invocation_at'>>

// Backend MCP endpoints return { success, data, ... } envelope
// while other endpoints return data directly. We must unwrap here.
interface Envelope<T> {
  success: boolean
  data: T
  total?: number
  page?: number
  page_size?: number
}

// ===== API functions =====

export async function fetchMcpServers(params?: Record<string, string>): Promise<{ items: McpServer[]; total: number }> {
  const query = new URLSearchParams(params).toString()
  const path = `/api/v1/admin/mcp-servers${query ? `?${query}` : ''}`
  const res = await authClient.get<Envelope<McpServer[]>>(path)
  return { items: res.data, total: res.total ?? 0 }
}

export async function fetchMcpServer(id: string): Promise<McpServer> {
  const res = await authClient.get<Envelope<McpServer>>(`/api/v1/admin/mcp-servers/${id}`)
  return res.data
}

export async function createMcpServer(data: McpServerFormData): Promise<McpServer> {
  const res = await authClient.post<Envelope<McpServer>>('/api/v1/admin/mcp-servers', data)
  return res.data
}

export async function updateMcpServer(id: string, data: McpServerFormData): Promise<McpServer> {
  const res = await authClient.patch<Envelope<McpServer>>(`/api/v1/admin/mcp-servers/${id}`, data)
  return res.data
}

export async function deleteMcpServer(id: string): Promise<void> {
  await authClient.delete(`/api/v1/admin/mcp-servers/${id}`)
}

export async function testMcpConnection(id: string): Promise<{ success: boolean; message: string; latency_ms?: number }> {
  const res = await authClient.post<Envelope<{ ok: boolean; message: string; latency_ms: number }>>(`/api/v1/admin/mcp-servers/${id}/test`, {})
  return { success: res.data.ok, message: res.data.message, latency_ms: res.data.latency_ms }
}

export async function fetchMcpPolicy(): Promise<McpPolicy> {
  const res = await authClient.get<Envelope<McpPolicy>>('/api/v1/tenant/mcp-policy')
  return res.data
}

export async function updateMcpPolicy(data: Partial<McpPolicy>): Promise<McpPolicy> {
  const res = await authClient.patch<Envelope<McpPolicy>>('/api/v1/admin/mcp-policy', data)
  return res.data
}

export async function fetchMcpAuditLogs(params?: Record<string, string>): Promise<{ items: McpAuditLog[]; total: number }> {
  const query = new URLSearchParams(params).toString()
  const path = `/api/v1/admin/mcp-audit-logs${query ? `?${query}` : ''}`
  const res = await authClient.get<Envelope<McpAuditLog[]>>(path)
  return { items: res.data, total: res.total ?? 0 }
}
