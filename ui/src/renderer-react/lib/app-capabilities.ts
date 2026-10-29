import type { AppMcpServiceTools, StoredApp } from '../types';

export const hasMcpCatalog = (service: AppMcpServiceTools) => service.catalogSource === 'cache' || service.catalogSource === 'live' || service.status === 'connected' || service.tools.length > 0;

export function appConnectorStatus(app: StoredApp) {
  return !app.enabled ? '已停用' : !app.grants?.includes('connector:use') ? '待授权' : app.connectorApp?.connection?.connected ? '已就绪' : '待连接';
}

export function appCapabilitySummary(app: StoredApp) {
  if (app.connectorApp) return `${app.connectorApp.capabilities.map(kind => kind === 'skills' ? '技能' : kind.toUpperCase()).join(' · ')} · ${appConnectorStatus(app)}`;
  const native = app.agentTools?.length || 0;
  const skills = app.contributes?.skills?.length || 0;
  const services = app.mcpServices || [];
  const mcp = services.reduce((sum, service) => sum + service.tools.length, 0);
  const pending = services.some(service => service.truncated || !hasMcpCatalog(service));
  const parts: string[] = [];
  if (native + mcp) parts.push(`${pending ? '至少 ' : ''}${native + mcp} 个 AI 工具`);
  if (skills) parts.push(`${skills} 个 CLI skill`);
  if (services.some(service => service.status === 'failed')) parts.push('连接失败');
  else if (services.some(service => ['unauthorized','needs-auth','credentials-missing'].includes(service.status))) parts.push('需要授权或配置');
  else if (services.some(service => ['app-disabled','instance-disabled','disabled'].includes(service.status))) parts.push('服务已停用');
  return parts.join(' · ') || (pending || services.some(service => service.catalogSource === 'cache') ? 'AI 能力' : '暂无 AI 工具');
}
