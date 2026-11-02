import { createHash } from 'node:crypto';
import { parseAppServiceKey } from '../../packages/app-sdk/src/tool-services.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const matches = (entry, query) => !query || [entry.id, entry.displayName, entry.name, entry.description, entry.summary,
  ...(Array.isArray(entry.tags) ? entry.tags : [])].join(' ').toLowerCase().includes(query.toLowerCase());

/** No installer is exposed through the model-facing discovery method. */
export function createProjectCreationResources({ installed, search, detail, install, validateApp }) {
  function normalize(kind, entry, isInstalled) {
    const version = String(entry.version || entry.currentVersion || entry.latestVersion || '');
    const source = entry.isBuiltin ? 'builtin' : isInstalled ? 'installed' : 'marketplace';
    return { kind, id: entry.id, runtimeId: entry.runtimeId || entry.id,
      displayName: String(entry.displayName || entry.name || entry.id), description: String(entry.description || entry.summary || '').slice(0, 2000),
      source, version, installed: isInstalled, enabled: entry.enabled !== false,
      status: isInstalled ? entry.enabled === false ? 'disabled' : 'installed' : 'missing',
      permissions: entry.permissions || [], toolSelection: entry.toolSelection || 'app', services: entry.services || [],
      fingerprint: fingerprint([kind, entry.id, version, entry.digest || entry.sha256 || entry.checksum || '', entry.updatedAt || entry.manifestUpdatedAt || '',
        entry.sourceManifest || '', entry.promptFile || '', entry.permissions || [], entry.source || '', entry.enabled !== false]),
    };
  }
  async function inspect({ kind, id }) {
    if (!['skill', 'expert', 'app'].includes(kind) || typeof id !== 'string' || !id.trim()) throw new Error('资源类型或 ID 无效。');
    const local = (await installed(kind)).find(entry => entry.id === id);
    if (local) return normalize(kind, local, true);
    const remote = await detail(kind, id);
    if (!remote || remote.id !== id) throw new Error(`找不到资源：${id}`);
    return normalize(kind, remote, false);
  }
  async function discover(input = {}) {
    const { kind, action, query = '', id } = input;
    if (!['skill', 'expert', 'app'].includes(kind)) throw new Error('资源类型无效。');
    if (action === 'inspect') return inspect({ kind, id });
    const limit = Math.min(30, Math.max(1, Number(input.limit) || 10));
    const offset = Math.max(0, Number(input.offset) || 0);
    if (action === 'list_installed') {
      const entries = (await installed(kind)).filter(entry => matches(entry, query));
      return { kind, source: 'installed', resources: entries.slice(offset, offset + limit).map(entry => normalize(kind, entry, true)),
        total: entries.length, nextOffset: offset + limit < entries.length ? offset + limit : null };
    }
    if (action === 'search') {
      if (!query.trim()) throw new Error('请提供搜索关键词。');
      const entries = await search(kind, query, limit);
      return { kind, source: 'marketplace', resources: entries.map(entry => normalize(kind, entry, false)) };
    }
    throw new Error('此工具仅支持列出、搜索和查看资源。安装只能在确认项目方案后进行。');
  }
  async function installSelected(selected) {
    const local = (await installed(selected.kind)).find(entry => entry.id === selected.id);
    if (local) return;
    const remote = await detail(selected.kind, selected.id);
    if (!remote || remote.id !== selected.id) throw new Error(`找不到资源：${selected.id}`);
    if (normalize(selected.kind, remote, false).fingerprint !== selected.fingerprint) throw new Error('市场资源已变化，请修改方案并重新确认。');
    const result = await install(selected.kind, remote);
    if (result?.ok === false || result?.success === false) throw new Error(result.error || (result.canceled ? '已取消资源安装，可重试或移除此资源。' : '资源安装需要完成权限确认。'));
  }
  async function validate(draft) {
    const pending = [];
    for (const entry of draft.resources) {
      if (entry.kind !== 'app') {
        if (!entry.enabled) throw new Error(`请先在资源管理中启用“${entry.displayName}”，或从方案中移除。`);
        continue;
      }
      const selected = draft.project.appServiceIds.filter(id => parseAppServiceKey(id)?.appId === entry.id);
      try {
        if (entry.toolSelection === 'services' && !selected.length) throw new Error('请在修改方案中选择需要的 App 子服务。');
        await validateApp(entry, selected);
      } catch (error) { pending.push({ appId: entry.id, displayName: entry.displayName, message: error.message }); }
    }
    return pending;
  }
  return { inspect, discover, install: installSelected, validate };
}
