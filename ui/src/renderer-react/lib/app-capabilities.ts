import type { StoredApp } from '../types';

export function appCapabilitySummary(app: StoredApp) {
  const native = app.agentTools?.length || 0;
  const skills = app.contributes?.skills?.length || 0;
  const services = app.mcpServices || [];
  const mcp = services.reduce((sum, service) => sum + service.tools.length, 0);
  const pending = services.some(service => service.truncated || !service.tools.length && service.status !== 'connected');
  const parts: string[] = [];
  if (native + mcp) parts.push(`${pending ? '至少 ' : ''}${native + mcp} 个 AI 工具`);
  if (skills) parts.push(`${skills} 个 CLI skill`);
  if (pending) parts.push(services.some(service => service.status === 'failed') ? 'MCP 工具加载失败'
    : services.some(service => ['unauthorized','needs-auth','credentials-missing'].includes(service.status)) ? 'MCP 工具待授权'
      : services.some(service => ['app-disabled','instance-disabled','disabled'].includes(service.status)) ? 'MCP 服务已停用' : 'MCP 工具待发现');
  return parts.join(' · ') || '暂无 AI 工具';
}
