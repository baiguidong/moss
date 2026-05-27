/**
 * MCP 配置解析器
 * 支持 Claude Desktop、mcporter、Sudowork 等常见 MCP 配置格式
 */

// 解析结果类型
export interface McpConfigParseResult {
  success: boolean
  mcp_type?: 'stdio' | 'http' | 'sse'
  data?: {
    name?: string | null
    mcp_type: 'stdio' | 'http' | 'sse'
    url?: string | null
    command?: string | null
    args_json?: string | null
    env_json?: string | null
    auth_config_json?: string | null
    timeout_ms?: number
  }
  error?: string
  warnings?: string[]
}

// 敏感字段名模式
const SENSITIVE_PATTERNS = [
  /TOKEN/i,
  /SECRET/i,
  /PASSWORD/i,
  /KEY$/i,
  /API_KEY/i,
  /AUTH/i,
]

/**
 * 检测敏感字段
 */
function detectSensitiveFields(obj: Record<string, unknown>): string[] {
  const warnings: string[] = []
  for (const key of Object.keys(obj)) {
    for (const pattern of SENSITIVE_PATTERNS) {
      if (pattern.test(key)) {
        warnings.push(`检测到敏感字段: ${key}`)
        break
      }
    }
  }
  return warnings
}

/**
 * 识别 MCP 传输类型
 */
function identifyMcpType(config: Record<string, unknown>): 'stdio' | 'http' | 'sse' {
  // 检查是否有 command 字段（stdio 模式）
  if (config.command || (config.transport as Record<string, unknown>)?.command) {
    return 'stdio'
  }

  // 检查是否有 headers 字段，这通常意味着 http/sse 类型
  if (config.headers || (config.transport as Record<string, unknown>)?.headers) {
    return 'http' // headers 通常用于 HTTP/SSE，默认为 http
  }

  // 检查是否有 url 字段（http/sse 模式）
  const url = config.url
    || (config.baseUrl as string | undefined)
    || (config.transport as Record<string, unknown>)?.url as string | undefined
    || ''

  if (url && typeof url === 'string') {
    // SSE 识别：包含 /sse 路径
    if (url.includes('/sse')) {
      return 'sse'
    }
    return 'http'
  }

  // 默认返回 stdio（由后续错误处理判断）
  return 'stdio'
}

/**
 * 递归提取配置中的字段
 */
function extractConfig(
  config: Record<string, unknown>,
  target: Record<string, unknown>
): void {
  // 直接在顶层查找字段
  if (config.command) target.command = config.command
  if (config.args) target.args = config.args
  if (config.env) target.env = config.env
  if (config.url) target.url = config.url
  if (config.baseUrl) target.url = config.baseUrl
  if (config.headers) target.headers = config.headers
  if (config.timeoutMs) target.timeoutMs = config.timeoutMs
  if (config.idleTimeoutMs) target.timeoutMs = config.idleTimeoutMs

  // 检查 transport 嵌套结构（Sudowork 格式）
  const transport = config.transport as Record<string, unknown> | undefined
  if (transport) {
    if (transport.command) target.command = transport.command
    if (transport.args) target.args = transport.args
    if (transport.env) target.env = transport.env
    if (transport.url) target.url = transport.url
    if (transport.headers) target.headers = transport.headers
  }
}

/**
 * 解析 MCP 配置 JSON
 * @param jsonStr JSON 字符串
 * @returns 解析结果
 */
export function parseMcpConfig(jsonStr: string): McpConfigParseResult {
  // 1. JSON 格式验证
  let config: Record<string, unknown>
  try {
    config = JSON.parse(jsonStr)
  } catch {
    return {
      success: false,
      error: '无效的 JSON 格式',
    }
  }

  if (!config || typeof config !== 'object') {
    return {
      success: false,
      error: '配置必须是一个 JSON 对象',
    }
  }

  const warnings: string[] = []

  // 2. 识别配置格式并提取服务名称
  let serviceName: string | null = null
  let actualConfig: Record<string, unknown> = config

  // 检查是否是 Sudowork 格式（直接包含 transport 字段）
  if (config.transport && typeof config.transport === 'object') {
    actualConfig = config as Record<string, unknown>
    // Sudowork 格式无顶层服务名
    serviceName = null
  } else {
    // Claude Desktop / mcporter 格式：顶层键是服务名，值是配置对象
    const keys = Object.keys(config)
    if (keys.length === 0) {
      return {
        success: false,
        error: '无法识别配置：空对象',
      }
    }

    // 找到第一个非特殊键作为服务名和配置
    for (const key of keys) {
      const value = config[key]
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        serviceName = key
        actualConfig = value as Record<string, unknown>
        break
      }
    }

    if (!actualConfig || Object.keys(actualConfig).length === 0) {
      return {
        success: false,
        error: '无法识别配置：未找到有效的 MCP 配置结构',
      }
    }
  }

  // 3. 提取配置字段
  const extracted: Record<string, unknown> = {}
  extractConfig(actualConfig, extracted)

  // 4. 识别 MCP 类型
  const mcpType = identifyMcpType(extracted)

  // 5. 检测敏感字段
  if (extracted.env && typeof extracted.env === 'object') {
    warnings.push(...detectSensitiveFields(extracted.env as Record<string, unknown>))
  }

  // 6. 构建结果
  const result: McpConfigParseResult = {
    success: true,
    mcp_type: mcpType,
    data: {
      name: serviceName,
      mcp_type: mcpType,
      url: typeof extracted.url === 'string' ? extracted.url : null,
      command: typeof extracted.command === 'string' ? extracted.command : null,
      args_json: extracted.args ? JSON.stringify(extracted.args) : null,
      env_json: extracted.env ? JSON.stringify(extracted.env) : null,
      auth_config_json: extracted.headers ? JSON.stringify(extracted.headers) : null,
      timeout_ms: typeof extracted.timeoutMs === 'number'
        ? extracted.timeoutMs
        : typeof extracted.timeoutMs === 'string'
          ? parseInt(extracted.timeoutMs, 10)
          : undefined,
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  }

  // 验证至少有必要的字段
  if (mcpType === 'stdio' && !result.data?.command) {
    return {
      success: false,
      error: 'stdio 类型配置必须包含 command 字段',
    }
  }

  if ((mcpType === 'http' || mcpType === 'sse') && !result.data?.url) {
    return {
      success: false,
      error: `${mcpType} 类型配置必须包含 url 或 baseUrl 字段`,
    }
  }

  return result
}