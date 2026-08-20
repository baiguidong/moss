import React, { useEffect, useMemo, useState } from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { McpAuthProvider } from '../../services/mcp/auth.js'
import type {
  McpHTTPServerConfig,
  McpSSEServerConfig,
  McpStdioServerConfig,
} from '../../services/mcp/types.js'
import {
  extractAgentMcpServers,
  filterToolsByServer,
} from '../../services/mcp/utils.js'
import { useAppState } from '../../state/AppState.js'
import { getSessionIngressAuthToken } from '../../utils/sessionIngressAuth.js'
import { MCPAgentServerMenu } from './MCPAgentServerMenu.js'
import { MCPListPanel } from './MCPListPanel.js'
import { MCPRemoteServerMenu } from './MCPRemoteServerMenu.js'
import { MCPStdioServerMenu } from './MCPStdioServerMenu.js'
import { MCPToolDetailView } from './MCPToolDetailView.js'
import { MCPToolListView } from './MCPToolListView.js'
import type {
  AgentMcpServerInfo,
  MCPViewState,
  ServerInfo,
} from './types.js'

type Props = {
  onComplete: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}

function isManagedMcpTransport(
  type: string | undefined,
): type is undefined | 'stdio' | 'sse' | 'http' {
  return type === undefined || type === 'stdio' || type === 'sse' || type === 'http'
}

export function MCPSettings({ onComplete }: Props): React.ReactNode {
  const mcp = useAppState(s => s.mcp)
  const agentDefinitions = useAppState(s => s.agentDefinitions)
  const [viewState, setViewState] = useState<MCPViewState>({ type: 'list' })
  const [servers, setServers] = useState<ServerInfo[]>([])

  const agentMcpServers = useMemo(
    () => extractAgentMcpServers(agentDefinitions.allAgents),
    [agentDefinitions.allAgents],
  )

  const filteredClients = useMemo(
    () =>
      mcp.clients
        .filter(client => client.name !== 'ide')
        .filter(client => isManagedMcpTransport(client.config.type))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [mcp.clients],
  )

  useEffect(() => {
    let cancelled = false

    async function prepareServers(): Promise<void> {
      const serverInfos = await Promise.all(
        filteredClients.map(async client => {
          const scope = client.config.scope
          const isSSE = client.config.type === 'sse'
          const isHTTP = client.config.type === 'http'
          let isAuthenticated: boolean | undefined

          if (isSSE || isHTTP) {
            const authProvider = new McpAuthProvider(
              client.name,
              client.config as McpSSEServerConfig | McpHTTPServerConfig,
            )
            const tokens = await authProvider.tokens()
            const hasSessionAuth =
              getSessionIngressAuthToken() !== null &&
              client.type === 'connected'
            const hasToolsAndConnected =
              client.type === 'connected' &&
              filterToolsByServer(mcp.tools, client.name).length > 0
            isAuthenticated = Boolean(tokens) || hasSessionAuth || hasToolsAndConnected
          }

          const baseInfo = { name: client.name, client, scope }
          if (isSSE) {
            return {
              ...baseInfo,
              transport: 'sse' as const,
              isAuthenticated,
              config: client.config as McpSSEServerConfig,
            }
          }
          if (isHTTP) {
            return {
              ...baseInfo,
              transport: 'http' as const,
              isAuthenticated,
              config: client.config as McpHTTPServerConfig,
            }
          }
          return {
            ...baseInfo,
            transport: 'stdio' as const,
            config: client.config as McpStdioServerConfig,
          }
        }),
      )
      if (!cancelled) setServers(serverInfos)
    }

    void prepareServers()
    return () => {
      cancelled = true
    }
  }, [filteredClients, mcp.tools])

  useEffect(() => {
    if (servers.length === 0 && filteredClients.length > 0) return
    if (servers.length === 0 && agentMcpServers.length === 0) {
      onComplete(
        'No MCP servers configured. Please run /doctor if this is unexpected. Otherwise, run `moss mcp --help` to learn more.',
      )
    }
  }, [agentMcpServers.length, filteredClients.length, onComplete, servers.length])

  switch (viewState.type) {
    case 'list':
      return (
        <MCPListPanel
          servers={servers}
          agentServers={agentMcpServers}
          onSelectServer={server => setViewState({ type: 'server-menu', server })}
          onSelectAgentServer={(agentServer: AgentMcpServerInfo) =>
            setViewState({ type: 'agent-server-menu', agentServer })
          }
          onComplete={onComplete}
          defaultTab={viewState.defaultTab}
        />
      )
    case 'server-menu': {
      const serverTools = filterToolsByServer(mcp.tools, viewState.server.name)
      const onViewTools = () =>
        setViewState({ type: 'server-tools', server: viewState.server })
      const onCancel = () =>
        setViewState({ type: 'list', defaultTab: 'MCP servers' })

      if (viewState.server.transport === 'stdio') {
        return (
          <MCPStdioServerMenu
            server={viewState.server}
            serverToolsCount={serverTools.length}
            onViewTools={onViewTools}
            onCancel={onCancel}
            onComplete={onComplete}
          />
        )
      }

      return (
        <MCPRemoteServerMenu
          server={viewState.server}
          serverToolsCount={serverTools.length}
          onViewTools={onViewTools}
          onCancel={onCancel}
          onComplete={onComplete}
        />
      )
    }
    case 'server-tools':
      return (
        <MCPToolListView
          server={viewState.server}
          onSelectTool={(_, index) =>
            setViewState({
              type: 'server-tool-detail',
              server: viewState.server,
              toolIndex: index,
            })
          }
          onBack={() =>
            setViewState({ type: 'server-menu', server: viewState.server })
          }
        />
      )
    case 'server-tool-detail': {
      const serverTools = filterToolsByServer(mcp.tools, viewState.server.name)
      const tool = serverTools[viewState.toolIndex]
      if (!tool) {
        setViewState({ type: 'server-tools', server: viewState.server })
        return null
      }
      return (
        <MCPToolDetailView
          tool={tool}
          server={viewState.server}
          onBack={() =>
            setViewState({ type: 'server-tools', server: viewState.server })
          }
        />
      )
    }
    case 'agent-server-menu':
      return (
        <MCPAgentServerMenu
          agentServer={viewState.agentServer}
          onCancel={() => setViewState({ type: 'list', defaultTab: 'Agents' })}
          onComplete={onComplete}
        />
      )
  }
}
