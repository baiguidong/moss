import type { McpCatalog, McpConfig } from '../../../packages/app-sdk/src/mcp/index.mjs';

export function createMcpConnectionDrafts(catalog: McpCatalog) {
  return catalog.servers.map(server => {
    const { disabledTools: _disabledTools, ...config } = server.config;
    return {
      name: server.name, enabled: server.enabled, disabledTools: server.config.disabledTools,
      config: JSON.stringify(config, null, 2),
      directories: server.config.roots?.directories.join('\n'),
      executables: server.config.pathBindings?.filter(binding => binding.kind === 'git-repository')
        .map(binding => ({ argument: binding.argument, value: binding.executable || '' })),
    };
  });
}

const configKey = (value: unknown) => JSON.stringify(value, (_key, entry) => entry && typeof entry === 'object' && !Array.isArray(entry)
  ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b))) : entry);

export function parseMcpConnectionDrafts(drafts: ReturnType<typeof createMcpConnectionDrafts>, catalog: McpCatalog) {
  // Validate every draft before saving any service. Enablement and exclusions
  // are existing policy, not connection fields editable through this form.
  return drafts.map(draft => {
    const config: McpConfig = JSON.parse(draft.config);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('连接配置必须是 JSON 对象。');
    const { disabledTools: _disabledTools, ...connectionConfig } = config;
    return { name: draft.name, previousName: draft.name, enabled: draft.enabled, config: {
      ...connectionConfig,
      ...(draft.disabledTools ? { disabledTools: draft.disabledTools } : {}),
      ...(config.roots && draft.directories !== undefined ? { roots: { ...config.roots, directories: draft.directories.split('\n').map(value => value.trim()).filter(Boolean) } } : {}),
      ...(config.pathBindings ? { pathBindings: config.pathBindings.map(binding => ({ ...binding,
        ...(binding.kind === 'git-repository' && draft.executables?.some(item => item.argument === binding.argument && (item.value.trim() || binding.executable !== undefined))
          ? { executable: draft.executables.find(item => item.argument === binding.argument)!.value.trim() } : {}),
      })) } : {}),
    } };
  }).filter(value => {
    const previous = catalog.servers.find(server => server.name === value.name);
    // A no-op save must not invalidate the persisted tool catalog.
    return !previous || previous.enabled !== value.enabled || configKey(previous.config) !== configKey(value.config);
  });
}
