import { containsProjectConfirmationBypass } from '../shared/project-confirmation-policy.mjs';

const CODE_TOOLS = new Set([
  'Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash', 'PowerShell',
  'NotebookEdit', 'LSP', 'ToolSearch', 'WebSearch', 'WebFetch',
]);
const MCP_RESOURCE_TOOLS = new Set(['ListMcpResourcesTool', 'ReadMcpResourceTool']);
const GENERIC_CLI_EXECUTABLES = new Set([
  'bash', 'bun', 'cmd', 'cmd.exe', 'env', 'node', 'npx', 'powershell',
  'powershell.exe', 'pwsh', 'python', 'python3', 'sh', 'zsh',
]);
const SECRET_KEY = /(?:token|secret|password|authorization|cookie|api[_-]?key|access[_-]?key|credential)/i;
const TOKEN_USAGE_KEY = /^(?:input|output|total|cached_input|cache_creation_input|cache_read_input)_tokens$/i;
const MAX_TRACE_STRING = 4_000;
export const CONNECTOR_AUTH_REQUIRED_PREFIX = 'GROUP_ROOM_CONNECTOR_AUTH_REQUIRED:';

function truncate(value, max = MAX_TRACE_STRING) {
  const text = String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(/([?&](?:access_token|refresh_token|api_key|token)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:access[_-]?token|refresh[_-]?token|api[_-]?key|secret|password|authorization)\b\s*[:=]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '[REDACTED_JWT]');
  return text.length > max ? `${text.slice(0, max)}... [truncated]` : text;
}

export function redactRoomValue(value, depth = 0) {
  if (depth > 8) return '[max depth]';
  if (typeof value === 'string') return truncate(value);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return value.slice(0, 100).map((entry) => redactRoomValue(entry, depth + 1));
  if (typeof value !== 'object') return truncate(value);
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 100)) {
    result[key] = SECRET_KEY.test(key) && !TOKEN_USAGE_KEY.test(key)
      ? '[REDACTED]'
      : redactRoomValue(entry, depth + 1);
  }
  return result;
}

function mcpServerFromTool(toolName) {
  const match = /^mcp__([^_].*?)__/.exec(String(toolName || ''));
  return match?.[1] || '';
}

function skillName(input) {
  return String(input?.skill || '').trim().replace(/^\//, '');
}

function commandExecutable(input) {
  const command = String(input?.command || '').trim();
  if (!command) return { command, executable: '', basename: '' };
  const match = command.match(/^(?:"([^"]+)"|'([^']+)'|([^\s]+))/);
  const executable = match?.[1] || match?.[2] || match?.[3] || '';
  const basename = executable.split(/[\\/]/).at(-1) || '';
  return { command, executable, basename };
}

function nameMatchesExecutable(name, executable, basename) {
  return name === executable || name === basename;
}

function commandMentionsExecutable(command, names) {
  return [...names].some((name) => {
    const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[\\s;&|()])(?:[^\\s;&|()]*[\\/])?${escaped}(?=$|[\\s;&|()])`).test(command);
  });
}

function validateConnectorCommand(input, allowedNames, knownNames) {
  const { command, executable, basename } = commandExecutable(input);
  const startsWithKnownConnector = [...knownNames]
    .some((name) => nameMatchesExecutable(name, executable, basename));
  const mentionsKnownConnector = commandMentionsExecutable(command, knownNames);
  if (!startsWithKnownConnector && !mentionsKnownConnector) return null;
  if (!startsWithKnownConnector || !command || /[\r\n;&|`<>$]/.test(command)) {
    return { behavior: 'deny', message: 'Connector CLI execution must use its assigned command directly without shell composition.' };
  }
  if (GENERIC_CLI_EXECUTABLES.has(basename.toLowerCase())) {
    return { behavior: 'deny', message: 'Generic interpreters cannot be used as connector CLI commands.' };
  }
  if (![...allowedNames].some((name) => nameMatchesExecutable(name, executable, basename))) {
    return { behavior: 'deny', message: `Connector CLI execution is not enabled for this room member: ${basename || executable}` };
  }
  return null;
}

function isConnectorAuthTool(toolName) {
  const action = String(toolName || '').split('__').at(-1) || '';
  return /(?:^|_)(?:auth|authenticate|authentication|authorize|authorization|login|oauth|refresh_token)(?:$|_)/i.test(action);
}

export function createRoomToolPolicy(resources) {
  const mcpServers = new Set(resources?.mcpServerNames || []);
  const mcpServerAccess = resources?.mcpServerAccess || {};
  const skills = new Set(resources?.skillCommands || []);
  const cliCommandNames = new Set(resources?.cliCommandNames || []);
  const knownCliCommandNames = new Set(resources?.knownCliCommandNames || resources?.cliCommandNames || []);

  return {
    validate(toolName, input, metadata = { readOnly: false }) {
      if (containsProjectConfirmationBypass(input)) {
        return {
          behavior: 'deny',
          message: 'Group Room tools cannot bypass connector confirmation.',
        };
      }
      if (CODE_TOOLS.has(toolName)) {
        if (toolName === 'Bash' || toolName === 'PowerShell') {
          return validateConnectorCommand(input, cliCommandNames, knownCliCommandNames);
        }
        return null;
      }
      if (toolName === 'Skill') {
        return skills.has(skillName(input))
          ? null
          : { behavior: 'deny', message: `Skill is not assigned to this room member: ${skillName(input) || 'unknown'}` };
      }
      if (MCP_RESOURCE_TOOLS.has(toolName)) {
        const server = String(input?.server || '').trim();
        if (server && !mcpServers.has(server)) {
          return { behavior: 'deny', message: `Connector server is not assigned to this room member: ${server}` };
        }
        if (toolName === 'ReadMcpResourceTool' && !server) {
          return { behavior: 'deny', message: 'ReadMcpResourceTool requires an assigned connector server.' };
        }
        return metadata.readOnly === true
          ? null
          : { behavior: 'deny', message: `${toolName} must remain read-only in Group Rooms.` };
      }
      if (String(toolName).startsWith('mcp__')) {
        const server = mcpServerFromTool(toolName);
        if (!mcpServers.has(server)) {
          return { behavior: 'deny', message: `Connector server is not assigned to this room member: ${server || 'unknown'}` };
        }
        if (isConnectorAuthTool(toolName)) {
          return {
            behavior: 'deny',
            message: `${CONNECTOR_AUTH_REQUIRED_PREFIX}${server || 'unknown'}`,
          };
        }
        if (mcpServerAccess[server] !== 'write' && metadata.readOnly !== true) {
          return { behavior: 'deny', message: `Connector is read-only for this room member: ${server}` };
        }
        return null;
      }
      return {
        behavior: 'deny',
        message: `Tool is not available in Group Rooms: ${toolName}`,
      };
    },

    shouldForcePermission(toolName, _input, metadata = { readOnly: false }) {
      return toolName === 'Skill'
        || MCP_RESOURCE_TOOLS.has(toolName)
        || String(toolName).startsWith('mcp__')
        || (CODE_TOOLS.has(toolName) && metadata.readOnly !== true);
    },
  };
}

export function extractAssistantText(message) {
  if (!Array.isArray(message?.message?.content)) return '';
  return message.message.content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text)
    .join('\n')
    .trim();
}

export function extractStreamDelta(message) {
  const event = message?.event;
  return message?.type === 'stream_event'
    && event?.type === 'content_block_delta'
    && event?.delta?.type === 'text_delta'
    && typeof event.delta.text === 'string'
    ? event.delta.text
    : '';
}

export function extractStableTraceEvents(message) {
  const events = [];
  const content = message?.message?.content;
  if (message?.type === 'assistant' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type !== 'tool_use') continue;
      events.push({
        type: 'tool_call',
        toolUseId: String(block.id || ''),
        name: String(block.name || 'Tool'),
        input: redactRoomValue(block.input || {}),
        timestamp: Date.now(),
      });
    }
  }
  if (message?.type === 'user' && Array.isArray(content)) {
    for (const block of content) {
      if (block?.type !== 'tool_result') continue;
      events.push({
        type: 'tool_result',
        toolUseId: String(block.tool_use_id || ''),
        isError: Boolean(block.is_error),
        content: redactRoomValue(block.content ?? ''),
        timestamp: Date.now(),
      });
    }
  }
  return events;
}

export function extractUsage(message) {
  if (message?.type !== 'result') return null;
  const usage = message.usage || message.modelUsage || message.model_usage;
  return usage && typeof usage === 'object' ? redactRoomValue(usage) : null;
}
