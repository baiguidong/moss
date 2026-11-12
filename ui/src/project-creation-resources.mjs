import { createHash } from 'node:crypto';
import { parseAppServiceKey } from '../../packages/app-sdk/src/tool-services.mjs';

const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const matches = (entry, query) => !query || [entry.id, entry.displayName, entry.name, entry.description, entry.summary,
  ...(Array.isArray(entry.tags) ? entry.tags : [])].join(' ').toLowerCase().includes(query.toLowerCase());

/** No installer is exposed through the model-facing discovery method. */
export function createProjectCreationResources({ installed, search, detail, install, validateApp, browse }) {
  function normalize(kind, entry, isInstalled) {
    const version = String(entry.version || entry.currentVersion || entry.latestVersion || '');
    const source = entry.isBuiltin ? 'builtin' : isInstalled ? 'installed' : 'marketplace';
    return { kind, id: entry.id, runtimeId: entry.runtimeId || entry.id, icon: entry.icon || entry.avatar || '',
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
    const local = (await installed(kind)).find(entry => entry.id === id || entry.runtimeId === id);
    if (local) return normalize(kind, local, true);
    const remote = await detail(kind, id);
    if (!remote || remote.id !== id) throw new Error(`找不到资源：${id}`);
    return normalize(kind, remote, false);
  }
  // Model-facing discovery does not need presentation assets. In particular,
  // installed App icons are often base64 data URLs and can turn a small lookup
  // into an oversized tool result that slows every subsequent model turn.
  function modelResource(entry) {
    return {
      kind: entry.kind,
      id: entry.id,
      runtimeId: entry.runtimeId,
      displayName: entry.displayName,
      description: entry.description,
      source: entry.source,
      version: entry.version,
      installed: entry.installed,
      enabled: entry.enabled,
      status: entry.status,
      ...(entry.kind === 'app' ? {
        toolSelection: entry.toolSelection,
        services: entry.services,
        permissions: entry.permissions,
      } : {}),
    };
  }
  async function list({ kind, query = '', page = 1, pageSize = 30 } = {}) {
    if (!['skill', 'expert', 'app'].includes(kind)) throw new Error('资源类型无效。');
    page = Math.max(1, Math.floor(Number(page) || 1));
    pageSize = Math.min(100, Math.max(1, Math.floor(Number(pageSize) || 30)));
    query = String(query).trim();
    const [localResult, remoteResult] = await Promise.allSettled([
      installed(kind), browse({ kind, query, page, pageSize }),
    ]);
    if (localResult.status === 'rejected') throw localResult.reason;
    const local = localResult.value;
    const matchingLocal = local.filter(entry => matches(entry, query));
    const remote = remoteResult.status === 'fulfilled' ? remoteResult.value : { entries: [], total: 0, hasMore: false };
    const entries = new Map();
    if (page === 1) for (const entry of matchingLocal) entries.set(entry.id, normalize(kind, entry, true));
    for (const entry of remote.entries) {
      const existing = local.find(item => item.id === entry.id);
      entries.set(entry.id, normalize(kind, existing || entry, Boolean(existing)));
    }
    return { resources: [...entries.values()], total: remote.total + matchingLocal.length, hasMore: remote.hasMore,
      warning: remoteResult.status === 'rejected' ? `市场暂不可用：${remoteResult.reason?.message || remoteResult.reason}` : null };
  }
  async function discover(input = {}) {
    const { kind, action, query = '', id } = input;
    if (!['skill', 'expert', 'app'].includes(kind)) throw new Error('资源类型无效。');
    if (action === 'inspect') return modelResource(await inspect({ kind, id }));
    const limit = Math.min(10, Math.max(1, Number(input.limit) || 6));
    const offset = Math.max(0, Number(input.offset) || 0);
    if (action === 'list_installed') {
      const entries = (await installed(kind)).filter(entry => matches(entry, query));
      return { kind, source: 'installed', resources: entries.slice(offset, offset + limit).map(entry => modelResource(normalize(kind, entry, true))),
        total: entries.length, nextOffset: offset + limit < entries.length ? offset + limit : null };
    }
    if (action === 'search') {
      if (!query.trim()) throw new Error('请提供搜索关键词。');
      const entries = await search(kind, query, limit);
      return { kind, source: 'marketplace', resources: entries.map(entry => modelResource(normalize(kind, entry, false))) };
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
  async function prepare(project, previous = null) {
    const refs = ['skill', 'expert', 'app'].flatMap(kind => {
      const ids = kind === 'app' ? [...(project.appIds || []), ...(project.appServiceIds || []).map(id => {
        const parsed = parseAppServiceKey(id);
        if (!parsed) throw new Error('App 服务选择无效。');
        return parsed.appId;
      })] : project[`${kind}Ids`] || [];
      return [...new Set(ids)].map(id => ({ kind, id }));
    });
    const resolved = [];
    const changed = [];
    for (const ref of refs) {
      let entry = await inspect(ref);
      const wasInstalled = entry.installed;
      if (!entry.installed) {
        await installSelected(entry);
        const installedEntry = await inspect({ kind: entry.kind, id: entry.id });
        if (!installedEntry.installed) throw new Error(`资源“${entry.displayName}”安装未完成。`);
        if (entry.version && installedEntry.version && entry.version !== installedEntry.version) throw new Error(`资源“${entry.displayName}”的安装版本发生变化，请重试。`);
        entry = installedEntry;
      }
      resolved.push(entry);
      const services = value => (value?.appServiceIds || []).filter(id => parseAppServiceKey(id)?.appId === entry.id).sort();
      const retained = previous && (previous[`${entry.kind}Ids`] || []).some(id => id === entry.id || id === entry.runtimeId);
      const retainedServiceApp = entry.kind === 'app' && services(previous).length > 0;
      if (!wasInstalled || (!retained && !retainedServiceApp) || (entry.kind === 'app' && JSON.stringify(services(previous)) !== JSON.stringify(services(project)))) changed.push(entry);
    }
    const pending = await validate({ project: { ...project, appServiceIds: project.appServiceIds || [] }, resources: changed });
    if (pending.length) throw new Error(pending.map(item => `${item.displayName}：${item.message}`).join('\n'));
    return {
      skillIds: resolved.filter(item => item.kind === 'skill').map(item => item.runtimeId),
      expertIds: resolved.filter(item => item.kind === 'expert').map(item => item.runtimeId),
      appIds: resolved.filter(item => item.kind === 'app' && item.toolSelection !== 'services').map(item => item.id),
      appServiceIds: project.appServiceIds || [],
      assistantName: project.assistantName ? resolved.find(item => item.kind === 'expert' && (item.id === project.assistantName || item.runtimeId === project.assistantName))?.runtimeId || project.assistantName : project.assistantName,
      resourceBindings: resolved,
    };
  }
  return { inspect, discover, list, prepare, install: installSelected, validate };
}
