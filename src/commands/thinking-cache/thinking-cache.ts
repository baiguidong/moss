import { clearThinkingCompatibilityCache } from '../../services/api/thinkingCompatibilityCache.js'
import type { LocalCommandCall } from '../../types/command.js'

export const call: LocalCommandCall = async args => {
  if (args.trim() !== 'clear') {
    return { type: 'text', value: '使用 /thinking-cache clear 清除思考兼容性缓存，下一次请求将按配置重新尝试。缓存会在 24 小时后自动过期。' }
  }
  try {
    await clearThinkingCompatibilityCache()
    return { type: 'text', value: '已清除思考兼容性缓存，下一次请求将按配置重新尝试。' }
  } catch {
    return { type: 'text', value: '清除思考兼容性缓存失败，请检查本地配置目录的写入权限。' }
  }
}
