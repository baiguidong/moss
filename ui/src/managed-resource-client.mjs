import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import JSZip from 'jszip';
import { managedPackageFiles } from '../../shared/managed-resource-package.mjs';
import { MOSS_HOME } from './moss-home.mjs';
import { readManagedCatalog, readManagedControlState } from './shared/managed-resource-state.mjs';

async function unpackResource(home, resource, download) {
  const { id, kind, slug, sha256 } = resource;
  if (!['skill', 'expert'].includes(kind) || !/^[a-z0-9][a-z0-9_.-]*$/i.test(slug) || !/^[a-f0-9]{64}$/.test(sha256)) throw new Error('服务端资源清单无效');
  const key = createHash('sha256').update(JSON.stringify([id, kind, slug, sha256])).digest('hex');
  const parent = path.join(home, 'managed-resources', key);
  const source = path.join(parent, slug);
  const entryPoint = kind === 'skill' ? 'SKILL.md' : 'assistant.md';
  if (!fs.existsSync(path.join(source, entryPoint))) {
    const bytes = await download();
    if (createHash('sha256').update(bytes).digest('hex') !== sha256) throw new Error(`${slug} 校验失败`);
    const files = managedPackageFiles(await JSZip.loadAsync(bytes), kind);
    await fsp.mkdir(parent, { recursive: true });
    const staging = await fsp.mkdtemp(path.join(path.dirname(parent), '.install-'));
    try {
      for (const { name, entry } of files) {
        const filename = path.join(staging, name);
        await fsp.mkdir(path.dirname(filename), { recursive: true });
        await fsp.writeFile(filename, await entry.async('nodebuffer'));
      }
      const metadataFile = path.join(staging, '_moss_meta.json');
      const metadata = fs.existsSync(metadataFile) ? JSON.parse(await fsp.readFile(metadataFile, 'utf8')) : {};
      await fsp.writeFile(metadataFile, JSON.stringify({ ...metadata, kind, id, name: slug, slug, display_name: resource.displayName, enabled: true, installed_version: resource.version, source_type: 'moss-server', ...(kind === 'expert' ? { prompt_file: entryPoint } : {}) }));
      try { await fsp.rename(staging, source); } catch (error) {
        if (!fs.existsSync(path.join(source, entryPoint))) throw error;
      }
    } finally {
      await fsp.rm(staging, { recursive: true, force: true });
    }
  }
  const expertMeta = kind === 'expert' ? JSON.parse(await fsp.readFile(path.join(source, '_moss_meta.json'), 'utf8')) : null;
  const icon = resource.icon?.startsWith('data:image/') ? resource.icon : '';
  return { id, kind, slug, name: slug, displayName: resource.displayName || slug, description: resource.description, icon,
    category: resource.category, version: resource.version, sha256, source, enabled: true, sourceType: 'moss-server',
    source_type: 'moss-server', ...(expertMeta ? { avatar: icon, categoryId: resource.category, categoryName: resource.category,
      promptFile: entryPoint, type: expertMeta.expert_type === 'team' ? 'team' : 'agent', members: expertMeta.members || [], skills: expertMeta.skills || [] } : {}) };
}

export function createManagedResourceClient({ resolveConnection, accountKey, fetchImpl = fetch, home = MOSS_HOME }) {
  const stateFile = path.join(home, 'managed-resource-control.json');
  const locked = { enabled: true, resources: [] };
  let generation = 0;
  let pending;
  let previousAccount;
  let lastSaved;
  let disabledForAccount = readManagedControlState(home)?.disabledForAccount;
  function save(state) {
    disabledForAccount = state ? undefined : previousAccount;
    const json = JSON.stringify(state || { enabled: false, disabledForAccount });
    if (json !== lastSaved) {
      fs.mkdirSync(home, { recursive: true });
      const tmp = stateFile + '.' + randomUUID();
      fs.writeFileSync(tmp, json, { mode: 0o600 });
      fs.renameSync(tmp, stateFile);
      lastSaved = json;
    }
    return state;
  }
  if (readManagedCatalog(home)) save(locked);

  async function refreshAccount(key, current) {
    function checkAccount() {
      if (generation !== current || key !== accountKey()) throw new Error('Moss 登录身份已变更');
    }
    try {
      if (!key) {
        if (readManagedCatalog(home)) throw new Error('请连接 Moss Server 确认资源授权');
        return null;
      }
      const { authToken, serverUrl, headers } = await resolveConnection();
      if (!authToken) throw new Error('请登录 Moss Server 获取授权清单');
      const get = async pathname => {
        checkAccount();
        const response = await fetchImpl(serverUrl.replace(/\/+$/, '') + pathname, {
          headers: { ...headers, authorization: 'Bearer ' + authToken }, redirect: 'error', signal: AbortSignal.timeout(30000),
        });
        if (!response.ok) throw new Error(`Moss Server 请求失败 (${response.status})`);
        return response;
      };
      const bootstrap = await (await get('/api/v1/bootstrap')).json();
      checkAccount();
      if (!bootstrap.capabilities) throw new Error('Moss Server 配置无效');
      if (!bootstrap.capabilities.resource_control?.enabled) return save(null);
      if (!readManagedCatalog(home)) save(locked);
      const manifest = await (await get('/api/v1/managed-resources/manifest')).json();
      checkAccount();
      if (manifest.enabled === false) return save(null);
      if (manifest.enabled !== true || !Array.isArray(manifest.resources)) throw new Error('服务端资源清单无效');
      const identity = JSON.stringify([serverUrl, manifest.orgId, manifest.userId]);
      const previous = readManagedCatalog(home);
      const granted = new Map(manifest.resources.map(r => [r.id, r]));
      const ready = previous?.identity === identity ? previous.resources.filter(r => granted.get(r.id)?.sha256 === r.sha256) : [];
      save({ enabled: true, identity, resources: ready });
      const resources = [];
      const errors = [];
      for (const resource of manifest.resources) {
        checkAccount();
        try {
          resources.push(await unpackResource(home, resource, async () => {
            const response = await get('/api/v1/managed-resources/' + resource.kind + '/' + encodeURIComponent(resource.id) + '/download');
            return Buffer.from(await response.arrayBuffer());
          }));
        } catch (error) { errors.push(`${resource.slug}: ${error.message}`); }
      }
      checkAccount();
      return save({ enabled: true, identity, resources, ...(errors.length ? { error: errors.join('\n') } : {}) });
    } catch (error) {
      checkAccount();
      if (key && disabledForAccount === key) return null;
      return save({ ...locked, error: error.message });
    }
  }
  return {
    refresh() {
      const key = accountKey();
      if (pending && previousAccount === key) return pending;
      if (previousAccount !== key && key !== disabledForAccount && (key || readManagedCatalog(home))) save(locked);
      previousAccount = key;
      const current = ++generation;
      pending = refreshAccount(key, current).finally(() => { if (current === generation) pending = null; });
      return pending;
    },
  };
}

export function managedResourcePage(catalog, kind, { query = '', category = '', type = 'all', page = 1, pageSize = 20 } = {}) {
  const needle = String(query).trim().toLowerCase();
  const matches = catalog.resources.filter(item => item.kind === kind && (!category || item.category === category) &&
    (type === 'all' || item.type === type) &&
    [item.slug, item.displayName, item.description].join(' ').toLowerCase().includes(needle));
  page = Math.max(1, Number(page) || 1);
  pageSize = Math.min(100, Math.max(1, Number(pageSize) || 20));
  return { entries: matches.slice((page - 1) * pageSize, page * pageSize), total: matches.length, page, pageSize, hasMore: page * pageSize < matches.length };
}

// All four existing IPC surfaces share the same read-only catalog in managed mode.
export function managedResourceIpc(ipc, client) {
  return { handle(method, original) {
    ipc.handle(method, async (event, payload = {}) => {
      const catalog = await client.refresh();
      if (!catalog) return original(event, payload);
      const kind = method.startsWith('public-skillhub:') || method.startsWith('skill-store:') ? 'skill' : 'expert';
      const items = catalog.resources.filter(item => item.kind === kind);
      const ok = data => ({ success: true, managed: true, data, error: catalog.error });
      const id = payload.id || payload.slug || payload.skillId || payload.expertId || payload.assistantId;
      const detail = items.find(item => item.id === id || item.slug === id);
      const action = method.split(':')[1];
      switch (action) {
        case 'get-config': return ok({ managed: true });
        case 'get-installed-skills': case 'get-installed-experts':
        case 'getInstalledSkills': case 'getInstalledAssistants': return ok(items);
        case 'fetch-categories': case 'fetchCategories': {
          const categories = [...new Set(items.map(item => item.category).filter(Boolean))].map(id => ({ id, key: id, name: id }));
          return ok(method === 'public-experthub:fetch-categories' ? { categories, manifests: [] } : categories);
        }
        case 'fetch-scenes': return ok({ scenes: [], total: 0, hasMore: false });
        case 'fetch-skills': case 'fetch-experts': case 'fetch-featured-experts':
        case 'fetchSkills': case 'fetchAssistants': {
          const legacy = action === 'fetchSkills' || action === 'fetchAssistants';
          const options = legacy ? { ...payload, page: payload.cursor, pageSize: payload.limit } : payload;
          const { entries, ...pagination } = managedResourcePage(catalog, kind, options);
          const key = kind === 'skill' ? 'skills' : action === 'fetchAssistants' ? 'assistants' : 'experts';
          return ok(legacy ? { [key]: entries, next_cursor: pagination.hasMore ? String(pagination.page + 1) : null, has_more: pagination.hasMore }
            : { [key]: entries, ...pagination });
        }
        case 'fetch-detail': case 'fetchSkillDetail': case 'fetchAssistantDetail':
          if (!detail) return { success: false, error: '资源不可用' };
          return ok(method === 'public-skillhub:fetch-detail' ? { skill: detail } : detail);
        case 'fetchSkillDetailsByIds':
          return ok(catalog.resources.filter(item => item.kind === 'skill' && payload.skillIds?.includes(item.id)));
        case 'getAssistantContext': case 'getSkillInfosByIds': case 'getAssistantContextWithSkills':
          return original(event, payload);
        default: return { success: false, managed: true, error: '请在 Moss Server 管理技能与专家。' };
      }
    });
  } };
}
