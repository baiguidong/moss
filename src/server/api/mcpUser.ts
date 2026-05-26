import type { McpStore } from '../mcp/db.js'
import type { AuthContext } from '../auth/token.js'
import type { McpServerInput } from '../mcp/types.js'
import { isVisibleTo, buildVisibilityFilter } from '../visibilityFilter.js'
import type { AuthService } from '../auth/service.js'
import { testMcpConnection } from '../mcp/testConnection.js'

interface McpUserDeps {
  mcpStore: McpStore
  authService: AuthService
  getUserName: (userId: string) => string | undefined
  getUserDepartmentId: (userId: string) => string | null
  getUserByIdAndOrg: (userId: string, orgId: string) => { role: string; departmentId: string | null } | null
  listDepartmentsByOrg: (orgId: string) => { id: string; parentId: string | null }[]
}

/** Fields excluded from user-side response (sensitive) */
const SENSITIVE_FIELDS = new Set([
  'env_json', 'auth_config_json', 'secret_ref', 'command', 'args_json',
  'created_by', 'updated_by',
])

function sanitizeForUser(server: Record<string, unknown>) {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(server)) {
    if (!SENSITIVE_FIELDS.has(key)) {
      result[key] = value
    }
  }
  return result
}

export function createMcpUserApi(deps: McpUserDeps) {
  const { mcpStore, authService, getUserName, getUserDepartmentId, getUserByIdAndOrg, listDepartmentsByOrg } = deps

  const api = {
    /**
     * GET /api/v1/me/mcp-servers
     * Returns all MCP servers visible to the current user.
     */
    async listMyMcpServers(auth: AuthContext) {
      const userDeptId = getUserDepartmentId(auth.userId)
      const filter = buildVisibilityFilter(
        auth,
        getUserByIdAndOrg,
        listDepartmentsByOrg,
      )

      // Get all enabled MCP servers for this org
      const allServers = mcpStore.listVisibleMcpServers(auth.orgId, auth.userId, userDeptId)

      // Filter by visibility
      const visibleServers = allServers.filter(server => isVisibleTo(server.visible_to, filter))

      // Sanitize sensitive fields
      const sanitized = visibleServers.map(s => sanitizeForUser(s as unknown as Record<string, unknown>))

      return { success: true, data: sanitized }
    },

    // ==================== Personal MCP CRUD (Phase 2) ====================

    /**
     * POST /api/v1/me/mcp-servers
     * Create a personal MCP server (scope=user).
     */
    async createPersonalMcp(auth: AuthContext, input: McpServerInput, ip?: string) {
      // Check policy: is personal MCP allowed?
      const policy = mcpStore.getMcpPolicy(auth.orgId)
      if (!policy.allow_personal_mcp) {
        return { success: false, error: { code: 'forbidden', message: '企业策略不允许创建个人 MCP' } }
      }

      // Enforce scope=user
      const personalInput: McpServerInput = {
        ...input,
        scope: 'user',
        owner_type: 'user',
        owner_id: auth.userId,
      }

      // Check policy constraints
      if (input.mcp_type === 'stdio' && !policy.allow_stdio_mcp) {
        return { success: false, error: { code: 'forbidden', message: '企业策略不允许使用 STDIO 类型 MCP' } }
      }
      if ((input.mcp_type === 'http' || input.mcp_type === 'sse') && !policy.allow_http_sse_mcp) {
        return { success: false, error: { code: 'forbidden', message: '企业策略不允许使用 HTTP/SSE 类型 MCP' } }
      }

      // Check name uniqueness
      const existing = mcpStore.getMcpServerByName(auth.orgId, input.name)
      if (existing) {
        return { success: false, error: { code: 'conflict', message: 'MCP 名称已存在' } }
      }

      const server = mcpStore.createMcpServer(auth.orgId, personalInput, auth.userId)

      // Write audit log
      try {
        mcpStore.insertAuditLog({
          org_id: auth.orgId,
          mcp_server_id: server.id,
          mcp_server_name: server.name,
          user_id: auth.userId,
          user_name: getUserName(auth.userId),
          action: 'create_personal',
          ip_address: ip,
        })
      } catch { /* ignore */ }

      // If policy requires approval, create approval request and set status to pending
      if (policy.require_approval) {
        mcpStore.setMcpServerStatus(auth.orgId, server.id, 'pending', null)
        mcpStore.createApprovalRequest({
          org_id: auth.orgId,
          user_id: auth.userId,
          user_name: getUserName(auth.userId),
          mcp_server_id: server.id,
        })
        return { success: true, data: { ...server, status: 'pending', _requires_approval: true } }
      }

      return { success: true, data: sanitizeForUser(server as unknown as Record<string, unknown>) }
    },

    /**
     * PATCH /api/v1/me/mcp-servers/:id
     * Update a personal MCP server.
     */
    async updatePersonalMcp(auth: AuthContext, id: string, input: Partial<McpServerInput>, ip?: string) {
      const server = mcpStore.getMcpServer(auth.orgId, id)
      if (!server) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      // Can only update own personal MCPs
      if (server.scope !== 'user' || server.owner_id !== auth.userId) {
        return { success: false, error: { code: 'forbidden', message: '只能修改自己的个人 MCP' } }
      }

      // Enforce scope stays as user
      if (input.scope && input.scope !== 'user') {
        return { success: false, error: { code: 'forbidden', message: '个人 MCP 作用域不可更改' } }
      }

      const updated = mcpStore.updateMcpServer(auth.orgId, id, input, auth.userId)

      try {
        mcpStore.insertAuditLog({
          org_id: auth.orgId,
          mcp_server_id: id,
          mcp_server_name: updated.name,
          user_id: auth.userId,
          user_name: getUserName(auth.userId),
          action: 'update_personal',
          request_params_json: JSON.stringify({ updated_fields: Object.keys(input) }),
          ip_address: ip,
        })
      } catch { /* ignore */ }

      return { success: true, data: sanitizeForUser(updated as unknown as Record<string, unknown>) }
    },

    /**
     * DELETE /api/v1/me/mcp-servers/:id
     * Delete a personal MCP server.
     */
    async deletePersonalMcp(auth: AuthContext, id: string, ip?: string) {
      const server = mcpStore.getMcpServer(auth.orgId, id)
      if (!server) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      if (server.scope !== 'user' || server.owner_id !== auth.userId) {
        return { success: false, error: { code: 'forbidden', message: '只能删除自己的个人 MCP' } }
      }

      const deleted = mcpStore.deleteMcpServer(auth.orgId, id)

      try {
        mcpStore.insertAuditLog({
          org_id: auth.orgId,
          mcp_server_id: null,
          mcp_server_name: server.name,
          user_id: auth.userId,
          user_name: getUserName(auth.userId),
          action: 'delete_personal',
          ip_address: ip,
        })
      } catch { /* ignore */ }

      return { success: true }
    },

    /**
     * POST /api/v1/me/mcp-servers/:id/test
     * Test personal MCP connection.
     */
    async testPersonalMcpConnection(auth: AuthContext, id: string, ip?: string) {
      const server = mcpStore.getMcpServer(auth.orgId, id)
      if (!server) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      if (server.scope !== 'user' || server.owner_id !== auth.userId) {
        return { success: false, error: { code: 'forbidden', message: '只能测试自己的个人 MCP' } }
      }

      const result = await testMcpConnection(server)

      // Update status
      if (result.ok) {
        mcpStore.setMcpServerStatus(auth.orgId, id, 'enabled', auth.userId)
      } else {
        mcpStore.setMcpServerStatus(auth.orgId, id, 'error', auth.userId)
      }

      try {
        mcpStore.insertAuditLog({
          org_id: auth.orgId,
          mcp_server_id: id,
          mcp_server_name: server.name,
          user_id: auth.userId,
          user_name: getUserName(auth.userId),
          action: 'test_connection',
          request_params_json: JSON.stringify({ ok: result.ok, latency_ms: result.latency_ms }),
          ip_address: ip,
        })
      } catch { /* ignore */ }

      return { success: true, data: result }
    },
  }

  return api
}

export type McpUserApi = ReturnType<typeof createMcpUserApi>
