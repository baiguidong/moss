export interface AppToolService {
  id: string; appId: string; serviceId: string; title: string; description: string;
  available: boolean; toolCount: number; status: string;
}
export interface ToolSource {
  appId: string; toolScope?: 'global' | 'session'; toolLoading?: 'always' | 'on-demand'; toolSelection?: 'app' | 'services'; serviceId?: string;
}
export function appServiceKey(appId: string, serviceId: string): string
export function parseAppServiceKey(value: string): { appId: string; serviceId: string } | null
export function isToolSourceSelected(owner: ToolSource, appIds?: readonly string[], appServiceIds?: readonly string[]): boolean
export function isToolSourceAvailable(owner: ToolSource, appIds?: readonly string[], appServiceIds?: readonly string[]): boolean
export function canSelectMcpService(service: { status: string; tools: Array<{ disabled: boolean }> }): boolean
export function getAppToolServices(app: {
  id?: string; name?: string; enabled?: boolean; toolSelection?: 'app' | 'services'; grants?: string[];
  contributes?: { services?: Array<{ id: string; title: string; description?: string }> } | null;
  agentTools?: Array<{ serviceId?: string; permission?: string }>;
  mcpServices?: Array<{ serviceId?: string; name: string; status: string; tools: Array<{ disabled: boolean }> }>;
}): AppToolService[]
