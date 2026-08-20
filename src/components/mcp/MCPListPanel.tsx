import figures from 'figures'
import React, { useCallback, useMemo, useState } from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { Box, color, Text, useTheme } from '../../ink.js'
import { useKeybindings } from '../../keybindings/useKeybinding.js'
import type { ConfigScope } from '../../services/mcp/types.js'
import { describeMcpConfigFilePath } from '../../services/mcp/utils.js'
import { isDebugMode } from '../../utils/debug.js'
import { plural } from '../../utils/stringUtils.js'
import { ConfigurableShortcutHint } from '../ConfigurableShortcutHint.js'
import { Byline } from '../design-system/Byline.js'
import { Dialog } from '../design-system/Dialog.js'
import { KeyboardShortcutHint } from '../design-system/KeyboardShortcutHint.js'
import { McpParsingWarnings } from './McpParsingWarnings.js'
import type { AgentMcpServerInfo, ServerInfo } from './types.js'

type Props = {
  servers: ServerInfo[]
  agentServers?: AgentMcpServerInfo[]
  onSelectServer: (server: ServerInfo) => void
  onSelectAgentServer?: (agentServer: AgentMcpServerInfo) => void
  onComplete: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
  defaultTab?: string
}

type SelectableItem =
  | { type: 'server'; server: ServerInfo }
  | { type: 'agent-server'; agentServer: AgentMcpServerInfo }

const SCOPE_ORDER: ConfigScope[] = ['project', 'local', 'user', 'enterprise']

function getScopeHeading(scope: ConfigScope): { label: string; path?: string } {
  switch (scope) {
    case 'project':
      return {
        label: 'Project MCPs',
        path: describeMcpConfigFilePath(scope),
      }
    case 'user':
      return {
        label: 'User MCPs',
        path: describeMcpConfigFilePath(scope),
      }
    case 'local':
      return {
        label: 'Local MCPs',
        path: describeMcpConfigFilePath(scope),
      }
    case 'enterprise':
      return { label: 'Enterprise MCPs' }
    case 'dynamic':
      return { label: 'Built-in MCPs', path: 'always available' }
    default:
      return { label: scope }
  }
}

function groupServersByScope(
  serverList: ServerInfo[],
): Map<ConfigScope, ServerInfo[]> {
  const groups = new Map<ConfigScope, ServerInfo[]>()
  for (const server of serverList) {
    const scope = server.scope
    if (!groups.has(scope)) groups.set(scope, [])
    groups.get(scope)!.push(server)
  }
  for (const [, groupServers] of groups) {
    groupServers.sort((a, b) => a.name.localeCompare(b.name))
  }
  return groups
}

export function MCPListPanel({
  servers,
  agentServers = [],
  onSelectServer,
  onSelectAgentServer,
  onComplete,
}: Props): React.ReactNode {
  const [theme] = useTheme()
  const [selectedIndex, setSelectedIndex] = useState(0)

  const serversByScope = useMemo(() => groupServersByScope(servers), [servers])
  const dynamicServers = useMemo(
    () => (serversByScope.get('dynamic') ?? []).sort((a, b) => a.name.localeCompare(b.name)),
    [serversByScope],
  )

  const selectableItems = useMemo<SelectableItem[]>(() => {
    const items: SelectableItem[] = []
    for (const scope of SCOPE_ORDER) {
      for (const server of serversByScope.get(scope) ?? []) {
        items.push({ type: 'server', server })
      }
    }
    for (const agentServer of agentServers) {
      items.push({ type: 'agent-server', agentServer })
    }
    for (const server of dynamicServers) {
      items.push({ type: 'server', server })
    }
    return items
  }, [agentServers, dynamicServers, serversByScope])

  const handleCancel = useCallback(() => {
    onComplete('MCP dialog dismissed', { display: 'system' })
  }, [onComplete])

  const handleSelect = useCallback(() => {
    const item = selectableItems[selectedIndex]
    if (!item) return
    if (item.type === 'server') {
      onSelectServer(item.server)
    } else {
      onSelectAgentServer?.(item.agentServer)
    }
  }, [onSelectAgentServer, onSelectServer, selectableItems, selectedIndex])

  useKeybindings(
    {
      'confirm:previous': () =>
        setSelectedIndex(prev =>
          prev === 0 ? selectableItems.length - 1 : prev - 1,
        ),
      'confirm:next': () =>
        setSelectedIndex(prev =>
          prev === selectableItems.length - 1 ? 0 : prev + 1,
        ),
      'confirm:yes': handleSelect,
      'confirm:no': handleCancel,
    },
    { context: 'Confirmation' },
  )

  const getServerIndex = useCallback(
    (server: ServerInfo) =>
      selectableItems.findIndex(
        item => item.type === 'server' && item.server === server,
      ),
    [selectableItems],
  )

  const getAgentServerIndex = useCallback(
    (agentServer: AgentMcpServerInfo) =>
      selectableItems.findIndex(
        item =>
          item.type === 'agent-server' && item.agentServer === agentServer,
      ),
    [selectableItems],
  )

  const renderServerItem = useCallback(
    (server: ServerInfo) => {
      const index = getServerIndex(server)
      const isSelected = selectedIndex === index
      let statusIcon: string
      let statusText: string

      if (server.client.type === 'disabled') {
        statusIcon = color('inactive', theme)(figures.radioOff)
        statusText = 'disabled'
      } else if (server.client.type === 'connected') {
        statusIcon = color('success', theme)(figures.tick)
        statusText = 'connected'
      } else if (server.client.type === 'pending') {
        statusIcon = color('inactive', theme)(figures.radioOff)
        const { reconnectAttempt, maxReconnectAttempts } = server.client
        statusText =
          reconnectAttempt && maxReconnectAttempts
            ? `reconnecting (${reconnectAttempt}/${maxReconnectAttempts})...`
            : 'connecting...'
      } else if (server.client.type === 'needs-auth') {
        statusIcon = color('warning', theme)(figures.triangleUpOutline)
        statusText = 'needs authentication'
      } else {
        statusIcon = color('error', theme)(figures.cross)
        statusText = 'failed'
      }

      return (
        <Box key={`${server.name}-${index}`}>
          <Text color={isSelected ? 'suggestion' : undefined}>
            {isSelected ? `${figures.pointer} ` : '  '}
          </Text>
          <Text color={isSelected ? 'suggestion' : undefined}>
            {server.name}
          </Text>
          <Text dimColor={!isSelected}> · {statusIcon} </Text>
          <Text dimColor={!isSelected}>{statusText}</Text>
        </Box>
      )
    },
    [getServerIndex, selectedIndex, theme],
  )

  const renderAgentServerItem = useCallback(
    (agentServer: AgentMcpServerInfo) => {
      const index = getAgentServerIndex(agentServer)
      const isSelected = selectedIndex === index
      const statusIcon = agentServer.needsAuth
        ? color('warning', theme)(figures.triangleUpOutline)
        : color('inactive', theme)(figures.radioOff)
      const statusText = agentServer.needsAuth ? 'may need auth' : 'agent-only'

      return (
        <Box key={`agent-${agentServer.name}-${index}`}>
          <Text color={isSelected ? 'suggestion' : undefined}>
            {isSelected ? `${figures.pointer} ` : '  '}
          </Text>
          <Text color={isSelected ? 'suggestion' : undefined}>
            {agentServer.name}
          </Text>
          <Text dimColor={!isSelected}> · {statusIcon} </Text>
          <Text dimColor={!isSelected}>{statusText}</Text>
        </Box>
      )
    },
    [getAgentServerIndex, selectedIndex, theme],
  )

  if (servers.length === 0 && agentServers.length === 0) return null

  const totalServers = servers.length + agentServers.length
  const hasFailedClients = servers.some(s => s.client.type === 'failed')
  const debugMode = isDebugMode()

  const content = (
    <Box flexDirection="column">
      {SCOPE_ORDER.map(scope => {
        const scopeServers = serversByScope.get(scope)
        if (!scopeServers || scopeServers.length === 0) return null
        const heading = getScopeHeading(scope)
        return (
          <Box key={scope} flexDirection="column" marginBottom={1}>
            <Box paddingLeft={2}>
              <Text bold>{heading.label}</Text>
              {heading.path && <Text dimColor> ({heading.path})</Text>}
            </Box>
            {scopeServers.map(renderServerItem)}
          </Box>
        )
      })}

      {agentServers.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Box paddingLeft={2}>
            <Text bold>Agent MCPs</Text>
          </Box>
          {[...new Set(agentServers.flatMap(s => s.sourceAgents))].map(
            agentName => (
              <Box key={agentName} flexDirection="column" marginTop={1}>
                <Box paddingLeft={2}>
                  <Text dimColor>@{agentName}</Text>
                </Box>
                {agentServers
                  .filter(s => s.sourceAgents.includes(agentName))
                  .map(renderAgentServerItem)}
              </Box>
            ),
          )}
        </Box>
      )}

      {dynamicServers.length > 0 && (
        <Box flexDirection="column" marginBottom={1}>
          <Box paddingLeft={2}>
            <Text bold>{getScopeHeading('dynamic').label}</Text>
            <Text dimColor> ({getScopeHeading('dynamic').path})</Text>
          </Box>
          {dynamicServers.map(renderServerItem)}
        </Box>
      )}

      <Box flexDirection="column">
        {hasFailedClients && (
          <Text dimColor>
            {debugMode
              ? '※ Error logs shown inline with --debug'
              : '※ Run moss --debug to see error logs'}
          </Text>
        )}
        <Text dimColor>Run `moss mcp --help` for help</Text>
      </Box>
    </Box>
  )

  return (
    <Box flexDirection="column">
      <McpParsingWarnings />
      <Dialog
        title="Manage MCP servers"
        subtitle={`${totalServers} ${plural(totalServers, 'server')}`}
        onCancel={handleCancel}
        hideInputGuide
      >
        {content}
      </Dialog>
      <Box paddingX={1}>
        <Text dimColor italic>
          <Byline>
            <KeyboardShortcutHint shortcut="↑↓" action="navigate" />
            <KeyboardShortcutHint shortcut="Enter" action="confirm" />
            <ConfigurableShortcutHint
              action="confirm:no"
              context="Confirmation"
              fallback="Esc"
              description="cancel"
            />
          </Byline>
        </Text>
      </Box>
    </Box>
  )
}
