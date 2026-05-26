import type { McpStore } from '../mcp/db.js'
import type { AuthContext } from '../auth/token.js'
import type { AuthService } from '../auth/service.js'
import type { McpServerInput, McpPolicyInput, McpServerListFilter, McpAuditLogFilter, McpTemplateListFilter } from '../mcp/types.js'
import { testMcpConnection } from '../mcp/testConnection.js'
import { broadcastMcpEvent } from './mcpEvents.js'

interface McpAdminDeps {
  mcpStore: McpStore
  authService: AuthService
  getUserName: (userId: string) => string | undefined
  getUserDepartmentId: (userId: string) => string | null
}

export function createMcpAdminApi(deps: McpAdminDeps) {
  const { mcpStore, authService, getUserName, getUserDepartmentId } = deps

  /**
   * dept_admin write constraint:
   * - Can only create scope=department MCP
   * - owner_id must be their own department
   * - Can only modify/delete MCPs where owner_type=department and owner_id is their department
   */
  function assertCanManageMcp(auth: AuthContext, input: { scope: string; owner_type: string; owner_id: string }, operation: string): void {
    if (auth.role === 'admin') return // admin has * scope, no restriction

    if (auth.role === 'dept_admin') {
      const deptId = getUserDepartmentId(auth.userId)
      if (input.scope === 'org') {
        throw Object.assign(new Error('部门管理员不能创建企业级 MCP'), { statusCode: 403 })
      }
      if (input.scope === 'department') {
        if (input.owner_id !== deptId) {
          throw Object.assign(new Error('部门管理员只能管理本部门的 MCP'), { statusCode: 403 })
        }
      }
      return
    }

    throw Object.assign(new Error('权限不足'), { statusCode: 403 })
  }

  function assertCanManageExistingMcp(auth: AuthContext, server: { scope: string; owner_type: string; owner_id: string }): void {
    if (auth.role === 'admin') return

    if (auth.role === 'dept_admin') {
      const deptId = getUserDepartmentId(auth.userId)
      if (server.owner_type === 'department' && server.owner_id === deptId) return
      throw Object.assign(new Error('权限不足，只能管理本部门的 MCP'), { statusCode: 403 })
    }

    throw Object.assign(new Error('权限不足'), { statusCode: 403 })
  }

  const writeAudit = (
    orgId: string,
    userId: string,
    action: string,
    mcpServerId: string | null,
    mcpServerName: string | null,
    detail?: Record<string, unknown>,
    ip?: string,
    status?: 'success' | 'error',
  ) => {
    try {
      mcpStore.insertAuditLog({
        org_id: orgId,
        mcp_server_id: mcpServerId,
        mcp_server_name: mcpServerName,
        user_id: userId,
        user_name: getUserName(userId),
        action,
        request_params_json: detail ? JSON.stringify(detail) : null,
        status: status ?? null,
        ip_address: ip,
      })
    } catch {
      // Audit log failure should not block operations
    }
  }

  const api = {
    // ==================== MCP Server CRUD ====================

    listMcpServers(auth: AuthContext, filter?: McpServerListFilter, ip?: string) {
      authService.requireScope(auth, 'admin:mcp')
      // For dept_admin, push the visibility restriction into the SQL layer so that
      // `total` reflects the post-filter count and pagination remains correct.
      const effectiveFilter: McpServerListFilter = { ...(filter ?? {}) }
      if (auth.role === 'dept_admin') {
        const deptId = getUserDepartmentId(auth.userId) ?? ''
        effectiveFilter.dept_admin_department_id = deptId
      }
      const result = mcpStore.listMcpServers(auth.orgId, effectiveFilter)
      return { success: true, data: result.items, total: result.total, page: filter?.page ?? 1, page_size: filter?.page_size ?? 20 }
    },

    getMcpServer(auth: AuthContext, id: string) {
      authService.requireScope(auth, 'admin:mcp')
      const server = mcpStore.getMcpServer(auth.orgId, id)
      if (!server) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      if (auth.role === 'dept_admin') {
        assertCanManageExistingMcp(auth, server)
      }

      return { success: true, data: server }
    },

    createMcpServer(auth: AuthContext, input: McpServerInput, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      assertCanManageMcp(auth, input, 'create')

      // 必填字段校验
      if (!input.name || typeof input.name !== 'string' || !input.name.trim()) {
        const err = new Error('name 为必填字段')
        Object.assign(err, { statusCode: 400 })
        throw err
      }

      // Check name uniqueness
      const existing = mcpStore.getMcpServerByName(auth.orgId, input.name)
      if (existing) {
        const err = new Error('MCP 名称已存在')
        Object.assign(err, { statusCode: 409 })
        throw err
      }

      // 补全可枚举字段的默认值(与前端 wizard Select 默认值一致)
      const resolvedInput: McpServerInput = {
        scope: input.scope ?? 'org',
        owner_type: input.owner_type ?? 'system',
        mcp_type: input.mcp_type ?? 'http',
        risk_level: input.risk_level ?? 'low',
        auth_type: input.auth_type ?? 'none',
        timeout_ms: input.timeout_ms ?? 30000,
        ...input,
      }

      // Auto-fill owner_id when scope=org and owner_type=system
      if (resolvedInput.scope === 'org' && resolvedInput.owner_type === 'system' && !resolvedInput.owner_id) {
        resolvedInput.owner_id = auth.orgId
      }
      if (resolvedInput.scope === 'department' && resolvedInput.owner_type === 'department' && !resolvedInput.owner_id) {
        resolvedInput.owner_id = getUserDepartmentId(auth.userId) ?? ''
      }
      // Plan §2.2 step 5: scope=department MCPs default visible_to to {department_ids: [owner_id]}
      // so that without explicit visibility config they are scoped to their own department only.
      if (
        resolvedInput.scope === 'department'
        && resolvedInput.owner_id
        && resolvedInput.visible_to == null
      ) {
        resolvedInput.visible_to = { department_ids: [resolvedInput.owner_id] }
      }

      const server = mcpStore.createMcpServer(auth.orgId, resolvedInput, auth.userId)
      writeAudit(auth.orgId, auth.userId, 'create', server.id, server.name, { name: input.name }, ip)
      broadcastMcpEvent({ org_id: auth.orgId, type: 'mcp.changed' })
      return { success: true, data: server }
    },

    updateMcpServer(auth: AuthContext, id: string, input: Partial<McpServerInput>, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      const existing = mcpStore.getMcpServer(auth.orgId, id)
      if (!existing) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      assertCanManageExistingMcp(auth, existing)

      // If name is being changed, check uniqueness
      if (input.name && input.name !== existing.name) {
        const nameConflict = mcpStore.getMcpServerByName(auth.orgId, input.name)
        if (nameConflict) {
          const err = new Error('MCP 名称已存在')
          Object.assign(err, { statusCode: 409 })
          throw err
        }
      }

      const server = mcpStore.updateMcpServer(auth.orgId, id, input, auth.userId)
      writeAudit(auth.orgId, auth.userId, 'update', server.id, server.name, { updated_fields: Object.keys(input) }, ip)
      broadcastMcpEvent({ org_id: auth.orgId, type: 'mcp.changed' })
      return { success: true, data: server }
    },

    deleteMcpServer(auth: AuthContext, id: string, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      const existing = mcpStore.getMcpServer(auth.orgId, id)
      if (!existing) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      assertCanManageExistingMcp(auth, existing)

      const deleted = mcpStore.deleteMcpServer(auth.orgId, id)
      if (deleted) {
        writeAudit(auth.orgId, auth.userId, 'delete', null, existing.name, { id }, ip)
        broadcastMcpEvent({ org_id: auth.orgId, type: 'mcp.changed' })
      }
      return { success: true }
    },

    setMcpServerEnabled(auth: AuthContext, id: string, enabled: boolean, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      const existing = mcpStore.getMcpServer(auth.orgId, id)
      if (!existing) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      assertCanManageExistingMcp(auth, existing)

      const server = mcpStore.setMcpServerEnabled(auth.orgId, id, enabled, auth.userId)
      writeAudit(auth.orgId, auth.userId, enabled ? 'enable' : 'disable', id, existing.name, undefined, ip)
      broadcastMcpEvent({ org_id: auth.orgId, type: 'mcp.changed' })
      return { success: true, data: server }
    },

    async testConnection(auth: AuthContext, id: string, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      const server = mcpStore.getMcpServer(auth.orgId, id)
      if (!server) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      const result = await testMcpConnection(server)

      // Update status based on test result
      if (result.ok) {
        mcpStore.setMcpServerStatus(auth.orgId, id, 'enabled', auth.userId)
      } else {
        mcpStore.setMcpServerStatus(auth.orgId, id, 'error', auth.userId)
      }

      writeAudit(
        auth.orgId, auth.userId, 'test_connection', id, server.name,
        { ok: result.ok, message: result.message, latency_ms: result.latency_ms },
        ip,
        result.ok ? 'success' : 'error',
      )

      return { success: true, data: result }
    },

    // ==================== Audit Logs ====================

    getAuditLogs(auth: AuthContext, filter?: McpAuditLogFilter) {
      authService.requireScope(auth, 'admin:mcp:audit')
      const result = mcpStore.queryAuditLog(auth.orgId, filter)
      return { success: true, data: result.items, total: result.total, page: filter?.page ?? 1, page_size: filter?.page_size ?? 20 }
    },

    getServerAuditLogs(auth: AuthContext, serverId: string, filter?: Omit<McpAuditLogFilter, 'mcp_server_id'>) {
      authService.requireScope(auth, 'admin:mcp:audit')
      const server = mcpStore.getMcpServer(auth.orgId, serverId)
      if (!server) return { success: false, error: { code: 'not_found', message: 'MCP 服务不存在' } }

      const result = mcpStore.queryAuditLog(auth.orgId, { ...filter, mcp_server_id: serverId })
      return { success: true, data: result.items, total: result.total, page: filter?.page ?? 1, page_size: filter?.page_size ?? 20 }
    },

    // ==================== Policy ====================

    getMcpPolicy(auth: AuthContext) {
      const policy = mcpStore.getMcpPolicy(auth.orgId)
      return { success: true, data: policy }
    },

    updateMcpPolicy(auth: AuthContext, input: McpPolicyInput, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      const policy = mcpStore.upsertMcpPolicy(auth.orgId, input, auth.userId)
      writeAudit(auth.orgId, auth.userId, 'update_policy', null, null, { updated_fields: Object.keys(input) }, ip)
      broadcastMcpEvent({ org_id: auth.orgId, type: 'mcp.policy.changed' })
      return { success: true, data: policy }
    },

    // ==================== Approval Requests (Phase 2) ====================

    listApprovalRequests(auth: AuthContext, status?: string) {
      authService.requireScope(auth, 'admin:mcp')
      const requests = mcpStore.listApprovalRequests(auth.orgId, status)
      return { success: true, data: requests }
    },

    approveRequest(auth: AuthContext, requestId: string, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      const request = mcpStore.getMcpApprovalRequest(requestId)
      if (!request) return { success: false, error: { code: 'not_found', message: '审批请求不存在' } }
      if (request.org_id !== auth.orgId) return { success: false, error: { code: 'forbidden', message: '无权操作' } }
      if (request.status !== 'pending') return { success: false, error: { code: 'invalid_status', message: '该请求已处理' } }

      const updated = mcpStore.updateApprovalRequest(requestId, {
        status: 'approved',
        reviewed_by: auth.userId,
        reviewer_name: getUserName(auth.userId),
      })

      // Update the MCP server status to enabled
      if (updated) {
        mcpStore.setMcpServerStatus(auth.orgId, updated.mcp_server_id, 'enabled', auth.userId)
      }

      writeAudit(auth.orgId, auth.userId, 'approve_request', request.mcp_server_id, null, { request_id: requestId }, ip)
      return { success: true, data: updated }
    },

    rejectRequest(auth: AuthContext, requestId: string, reviewNote: string, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      const request = mcpStore.getMcpApprovalRequest(requestId)
      if (!request) return { success: false, error: { code: 'not_found', message: '审批请求不存在' } }
      if (request.org_id !== auth.orgId) return { success: false, error: { code: 'forbidden', message: '无权操作' } }
      if (request.status !== 'pending') return { success: false, error: { code: 'invalid_status', message: '该请求已处理' } }

      const updated = mcpStore.updateApprovalRequest(requestId, {
        status: 'rejected',
        reviewed_by: auth.userId,
        reviewer_name: getUserName(auth.userId),
        review_note: reviewNote,
      })

      writeAudit(auth.orgId, auth.userId, 'reject_request', request.mcp_server_id, null, { request_id: requestId, reason: reviewNote }, ip)
      return { success: true, data: updated }
    },

    // ==================== Templates (Phase 2, §4.6 模板市场) ====================

    listTemplates(auth: AuthContext, filter?: McpTemplateListFilter) {
      authService.requireScope(auth, 'admin:mcp')
      const result = mcpStore.listTemplates(auth.orgId, filter)
      return { success: true, data: result.items, total: result.total, page: filter?.page ?? 1, page_size: filter?.page_size ?? 20 }
    },

    getTemplate(auth: AuthContext, id: string) {
      authService.requireScope(auth, 'admin:mcp')
      const template = mcpStore.getTemplate(auth.orgId, id)
      if (!template) return { success: false, error: { code: 'not_found', message: '模板不存在' } }
      return { success: true, data: template }
    },

    installTemplate(auth: AuthContext, templateId: string, overrides?: Partial<McpServerInput>, ip?: string) {
      authService.requireScope(auth, 'admin:mcp:write')
      const template = mcpStore.getTemplate(auth.orgId, templateId)
      if (!template) return { success: false, error: { code: 'not_found', message: '模板不存在' } }

      // Build MCP server input from template
      const serverInput: McpServerInput = {
        name: overrides?.name ?? template.name,
        display_name: overrides?.display_name ?? template.display_name,
        description: overrides?.description ?? template.description,
        icon: overrides?.icon ?? template.icon,
        category: overrides?.category ?? template.category,
        risk_level: overrides?.risk_level ?? template.risk_level,
        scope: overrides?.scope ?? template.scope,
        owner_type: overrides?.owner_type ?? (template.scope === 'org' ? 'system' : 'department'),
        owner_id: overrides?.owner_id ?? (template.scope === 'org' ? auth.orgId : getUserDepartmentId(auth.userId) ?? ''),
        mcp_type: overrides?.mcp_type ?? template.mcp_type,
        url: overrides?.url ?? template.url,
        command: overrides?.command ?? template.command,
        args_json: overrides?.args_json ?? template.args_json,
        env_json: overrides?.env_json ?? template.env_json,
        timeout_ms: overrides?.timeout_ms ?? template.timeout_ms,
        auth_type: overrides?.auth_type ?? template.auth_type,
      }

      // Check name uniqueness
      const existing = mcpStore.getMcpServerByName(auth.orgId, serverInput.name)
      if (existing) {
        const err = new Error('MCP 名称已存在')
        Object.assign(err, { statusCode: 409 })
        throw err
      }

      assertCanManageMcp(auth, serverInput, 'install_template')

      // Auto-fill owner_id if still missing
      if (serverInput.scope === 'org' && serverInput.owner_type === 'system' && !serverInput.owner_id) {
        serverInput.owner_id = auth.orgId
      }

      const server = mcpStore.createMcpServer(auth.orgId, serverInput, auth.userId)

      // Increment template downloads
      mcpStore.incrementDownloads(auth.orgId, templateId)

      writeAudit(auth.orgId, auth.userId, 'create', server.id, server.name, { template_id: templateId, template_name: template.name }, ip)
      broadcastMcpEvent({ org_id: auth.orgId, type: 'mcp.changed' })
      return { success: true, data: server }
    },
  }

  return api
}

export type McpAdminApi = ReturnType<typeof createMcpAdminApi>
