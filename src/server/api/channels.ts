import type { DirectConnectStore } from '../db.js'
import { getChannelManager, getPairingService } from '../../channels/index.js'
import type { IChannelPluginConfig, PluginStatus } from '../../channels/types.js'

// Plugin type to name mapping
const PLUGIN_NAMES: Record<string, string> = {
  telegram: 'Telegram Bot',
  lark: '飞书 Bot',
  dingtalk: '钉钉 Bot',
  wechat: '个人微信 Bot',
  wecom: '企业微信 Bot',
}

export function createChannelsApi(db: DirectConnectStore) {
  const channelsApi = {
    /**
     * GET /api/v1/channels/plugins
     */
    getPlugins: async (orgId: string, userId: string) => {
      const rows = db.listChannelPlugins(userId)
      const KNOWN_TYPES = ['telegram', 'lark', 'dingtalk', 'wechat', 'wecom']
      const extractType = (id: string, rowType: string): string => {
        if (KNOWN_TYPES.includes(rowType)) return rowType
        for (const t of KNOWN_TYPES) {
          if (id.startsWith(t)) return t
        }
        return rowType
      }
      const plugins = rows.map((row) => {
        const id = String(row.id)
        const type = extractType(id, String(row.type)) as PluginType
        return {
          id,
          type,
          name: String(row.name) || PLUGIN_NAMES[type] || type,
          enabled: Boolean(row.enabled),
          credentials: row.credentials_json ? JSON.parse(String(row.credentials_json)) : undefined,
          config: row.config_json ? JSON.parse(String(row.config_json)) : undefined,
          status: String(row.status) as PluginStatus,
          lastConnected: row.last_connected ? Number(row.last_connected) : undefined,
          createdAt: Number(row.created_at),
          updatedAt: Number(row.updated_at),
        }
      })

      // Ensure all known channel types are present even if not in DB
      const existingTypes = new Set(plugins.map(p => p.type))
      for (const type of KNOWN_TYPES) {
        if (!existingTypes.has(type)) {
          const id = `${type}_default`
          plugins.push({
            id,
            type: type as PluginType,
            name: PLUGIN_NAMES[type] || type,
            enabled: false,
            credentials: undefined,
            config: undefined,
            status: 'stopped' as PluginStatus,
            lastConnected: undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          })
        }
      }

      return { plugins }
    },

    /**
     * GET /api/v1/channels/plugins/:id
     */
    getPlugin: async (orgId: string, userId: string, pluginId: string) => {
      const row = db.getChannelPlugin(pluginId, userId)
      const KNOWN_TYPES = ['telegram', 'lark', 'dingtalk', 'wechat', 'wecom']
      if (!row) {
        const type = KNOWN_TYPES.find(t => pluginId.startsWith(t))
        if (type) {
          return {
            id: pluginId,
            type,
            name: PLUGIN_NAMES[type] || type,
            enabled: false,
            status: 'stopped' as PluginStatus,
            lastConnected: undefined,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            credentials: undefined,
            config: undefined,
          }
        }
        return null
      }
      const rowType = String(row.type)
      const type = KNOWN_TYPES.includes(rowType) ? rowType : KNOWN_TYPES.find(t => pluginId.startsWith(t)) || rowType
      return {
        id: String(row.id),
        type,
        name: String(row.name),
        enabled: Boolean(row.enabled),
        status: String(row.status) as PluginStatus,
        lastConnected: row.last_connected ? Number(row.last_connected) : undefined,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        credentials: row.credentials_json ? JSON.parse(String(row.credentials_json)) : undefined,
        config: row.config_json ? JSON.parse(String(row.config_json)) : undefined,
      }
    },

    /**
     * POST /api/v1/channels/plugins/:id/enable
     */
    enablePlugin: async (orgId: string, userId: string, pluginId: string, body: any) => {
      console.log(`[ChannelsAPI] enablePlugin called: orgId=${orgId}, userId=${userId}, pluginId=${pluginId}`)

      const manager = getChannelManager()
      if (!manager.isInitialized()) {
        console.error('[ChannelsAPI] ChannelManager not initialized')
        return { ok: false, message: 'ChannelManager not initialized' }
      }

      const result = await manager.enablePlugin(pluginId, body, undefined, userId)

      if (!result.success) {
        console.error(`[ChannelsAPI] Failed to enable plugin ${pluginId}:`, result.error)
        return { ok: false, message: result.error || 'Failed to enable plugin' }
      }

      console.log(`[ChannelsAPI] Plugin ${pluginId} enabled successfully for user ${userId}`)
      return { ok: true }
    },

    /**
     * POST /api/v1/channels/plugins/:id/disable
     */
    disablePlugin: async (orgId: string, userId: string, pluginId: string) => {
      console.log(`[ChannelsAPI] disablePlugin called: orgId=${orgId}, userId=${userId}, pluginId=${pluginId}`)

      const manager = getChannelManager()
      if (!manager.isInitialized()) {
        console.error('[ChannelsAPI] ChannelManager not initialized')
        return { ok: false, message: 'ChannelManager not initialized' }
      }

      const result = await manager.disablePlugin(pluginId, userId)

      if (!result.success) {
        console.error(`[ChannelsAPI] Failed to disable plugin ${pluginId}:`, result.error)
        return { ok: false, message: result.error || 'Failed to disable plugin' }
      }

      console.log(`[ChannelsAPI] Plugin ${pluginId} disabled successfully for user ${userId}`)
      return { ok: true }
    },

    /**
     * POST /api/v1/channels/plugins/:id/test
     */
    testPlugin: async (orgId: string, userId: string, pluginId: string, body: any) => {
      const manager = getChannelManager()
      if (!manager.isInitialized()) {
        return { ok: false, message: 'ChannelManager not initialized' }
      }
      const result = await manager.testPlugin(pluginId, body)
      return { ok: result.success, message: result.error || result.botUsername }
    },

    /**
     * GET /api/v1/channels/pairings/pending
     */
    getPendingPairings: async (orgId: string, userId: string) => {
      const rows = db.listPendingPairingRequests()
      // Only show pairings for plugins belonging to this user
      const userPlugins = db.listChannelPlugins(userId)
      const userPluginTypes = new Set(userPlugins.map(r => String(r.type)))
      const pairings = rows
        .filter(row => userPluginTypes.has(String(row.platform_type)))
        .map((row) => ({
          code: String(row.code),
          platformUserId: String(row.platform_user_id),
          platformType: String(row.platform_type) as PluginType,
          displayName: row.display_name ? String(row.display_name) : undefined,
          requestedAt: Number(row.requested_at || row.created_at || Date.now()),
          expiresAt: Number(row.expires_at),
          status: 'pending' as const,
        }))
      return { pairings }
    },

    /**
     * POST /api/v1/channels/pairings/:code/approve
     */
    approvePairing: async (orgId: string, userId: string, code: string) => {
      const result = await getPairingService().approvePairing(code)
      if (result.success && result.user) {
        db.upsertChannelUser({
          ...result.user,
          platform_user_id: result.user.platformUserId,
          platform_type: result.user.platformType,
          display_name: result.user.displayName,
          authorized_at: result.user.authorizedAt,
          org_id: orgId,
          user_id: userId,
        } as any)
      }
      return { ok: result.success }
    },

    /**
     * POST /api/v1/channels/pairings/:code/reject
     */
    rejectPairing: async (orgId: string, userId: string, code: string) => {
      const result = await getPairingService().rejectPairing(code)
      return result
    },

    /**
     * GET /api/v1/channels/users
     */
    getUsers: async (orgId: string, userId: string) => {
      const rows = db.listChannelUsers()
      const users = rows
        .filter(row => String(row.user_id) === userId)
        .map((row) => ({
          id: String(row.id),
          platformUserId: String(row.platform_user_id),
          platformType: String(row.platform_type) as PluginType,
          displayName: row.display_name ? String(row.display_name) : undefined,
          authorizedAt: Number(row.authorized_at),
          lastActive: row.last_active ? Number(row.last_active) : undefined,
          sessionId: row.session_id ? String(row.session_id) : undefined,
        }))
      return { users }
    },

    /**
     * DELETE /api/v1/channels/users/:id
     */
    deleteUser: async (orgId: string, userId: string, targetUserId: string) => {
      // Only allow deleting users that belong to this authenticated user
      const targetUser = db.getChannelUserById(targetUserId)
      if (targetUser && String(targetUser.user_id) !== userId) {
        return { ok: false, message: 'Forbidden' }
      }
      db.deleteChannelUser(targetUserId)
      return { ok: true }
    },

    /**
     * DELETE /api/v1/channels/users?platform=xxx
     */
    deleteUsersByPlatform: async (orgId: string, userId: string, platformType: string) => {
      const count = db.deleteChannelUsersByPlatform(platformType, userId)
      return { ok: true, count }
    },

    /**
     * GET /api/v1/channels/sessions
     */
    getSessions: async (orgId: string, userId: string) => {
      const rows = db.listChannelSessions()
      // Sessions are linked to channel_users via user_id; filter by the authenticated user
      const channelUsers = db.listChannelUsers()
      const channelUserIds = new Set(
        channelUsers.filter(u => String(u.user_id) === userId).map(u => String(u.id))
      )
      return rows
        .filter(row => channelUserIds.has(String(row.user_id)))
        .map((row) => ({
          id: String(row.id),
          userId: String(row.user_id),
          agentType: String(row.agent_type),
          conversationId: row.conversation_id ? String(row.conversation_id) : undefined,
          workspace: row.workspace ? String(row.workspace) : undefined,
          chatId: row.chat_id ? String(row.chat_id) : undefined,
          createdAt: Number(row.created_at),
          lastActivity: Number(row.last_activity),
        }))
    },

    /**
     * DELETE /api/v1/channels/sessions/:id
     */
    deleteSession: async (orgId: string, userId: string, sessionId: string) => {
      db.deleteChannelSession(sessionId)
      return { success: true }
    },

    /**
     * GET /api/v1/channels/plugins/:id/credentials
     */
    getPluginCredentials: async (orgId: string, userId: string, pluginId: string) => {
      const row = db.getChannelPlugin(pluginId, userId)
      if (!row) {
        const KNOWN_TYPES = ['telegram', 'lark', 'dingtalk', 'wechat', 'wecom']
        const type = KNOWN_TYPES.find(t => pluginId.startsWith(t))
        if (type) return {}
        return null
      }
      const credentials = row.credentials_json ? JSON.parse(String(row.credentials_json)) : {}
      return credentials
    },

    /**
     * POST /api/v1/channels/settings/sync
     */
    syncChannelSettings: async (
      orgId: string,
      userId: string,
      body: {
        platform: string
        agent?: { backend: string; customAgentId?: string; name?: string }
        model?: { id: string; useModel: string }
      }
    ) => {
      console.log(`[ChannelsAPI] syncChannelSettings called:`, JSON.stringify(body, null, 2))

      const manager = getChannelManager()
      if (!manager.isInitialized()) {
        return { ok: false, message: 'ChannelManager not initialized' }
      }

      const sessionManager = manager.getSessionManager()
      if (sessionManager) {
        const cleared = sessionManager.clearAllSessions()
        console.log(`[ChannelsAPI] Cleared ${cleared} sessions for settings sync`)
      }

      const { platform, agent, model } = body
      const pluginId = `${platform}_default`
      const existing = db.getChannelPlugin(pluginId, userId)

      if (existing) {
        const config = existing.config_json ? JSON.parse(String(existing.config_json)) : {}
        if (agent) {
          config.agent = agent
        }
        if (model) {
          config.defaultModel = model
        }
        db.upsertChannelPlugin({
          id: pluginId,
          type: String(existing.type),
          name: String(existing.name),
          enabled: Boolean(existing.enabled) ? 1 : 0,
          status: String(existing.status),
          credentials_json: existing.credentials_json,
          config_json: JSON.stringify(config),
          last_connected: existing.last_connected ? Number(existing.last_connected) : null,
          user_id: userId,
        })
      }

      return { ok: true }
    },

    /**
     * POST /api/v1/channels/wechat/qr-start
     */
    startWechatQrLogin: async () => {
      try {
        const { WeChatApiClient } = await import('../../channels/plugins/wechat/WeChatApiClient.js')
        const client = new WeChatApiClient('')
        const response = await client.startQrLogin()
        if (!response.qrcode || !response.qrcode_img_content) {
          return { ok: false, error: response.errmsg || 'Failed to get QR code' }
        }
        return { ok: true, qrcode: response.qrcode, qrcodeImgContent: response.qrcode_img_content }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[ChannelsAPI] startWechatQrLogin error:', msg)
        return { ok: false, error: msg }
      }
    },

    /**
     * GET /api/v1/channels/wechat/qr-poll?qrcode=xxx
     */
    pollWechatQrStatus: async (qrcodeToken: string) => {
      try {
        const { WeChatApiClient } = await import('../../channels/plugins/wechat/WeChatApiClient.js')
        const client = new WeChatApiClient('')
        const response = await client.pollQrStatus(qrcodeToken)
        return {
          ok: true,
          status: response.status,
          botToken: response.bot_token,
          accountId: response.ilink_bot_id,
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        return { ok: false, error: msg }
      }
    },
  }

  return channelsApi
}

export type ChannelsApi = ReturnType<typeof createChannelsApi>

type PluginType = 'telegram' | 'lark' | 'dingtalk' | 'wechat' | 'wecom'
