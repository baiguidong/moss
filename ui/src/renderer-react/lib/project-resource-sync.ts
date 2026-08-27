type ResourceIpcInvoke = (channel: string, payload?: unknown) => Promise<unknown>;

type SyncProjectMarketplaceResourcesInput = {
  skillIds: string[];
  expertIds: string[];
  onProgress?: (message: string) => void;
};

type ResourceResponse = {
  success?: boolean;
  data?: unknown;
  error?: string;
};

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function uniqueIds(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function resourceKey(value: unknown) {
  return text(value).toLocaleLowerCase('en-US');
}

function addKey(keys: Set<string>, value: unknown) {
  const key = resourceKey(value);
  if (key) keys.add(key);
}

function addInstalledSkillKeys(keys: Set<string>, value: unknown) {
  const skill = record(value);
  if (!skill) return;
  addKey(keys, skill.id);
  addKey(keys, skill.slug);
  addKey(keys, skill.name);
  addKey(keys, skill.displayName);
  const namespace = record(skill.namespace);
  addKey(keys, namespace?.canonicalName);
  const handle = text(namespace?.handle);
  const slug = text(skill.slug);
  if (handle && slug) addKey(keys, `@${handle}/${slug}`);
}

function addInstalledExpertKeys(keys: Set<string>, value: unknown) {
  const expert = record(value);
  if (!expert) return;
  addKey(keys, expert.id);
  addKey(keys, expert.name);
  addKey(keys, expert.displayName);
  addKey(keys, expert.agentName);
  addKey(keys, expert.plugin);
}

function installedKeys(values: unknown, addKeys: (keys: Set<string>, value: unknown) => void) {
  const keys = new Set<string>();
  if (Array.isArray(values)) {
    for (const value of values) addKeys(keys, value);
  }
  return keys;
}

export function parseSkillCoordinate(skillId: string) {
  const normalized = skillId.trim();
  const match = normalized.match(/^@([^/]+)\/(.+)$/);
  return match
    ? { slug: match[2]!, namespace: match[1]! }
    : { slug: normalized, namespace: '' };
}

function responseDataArray(response: ResourceResponse) {
  return Array.isArray(response.data) ? response.data : [];
}

function responseError(response: ResourceResponse, fallback: string) {
  return text(response.error) || fallback;
}

export async function syncProjectMarketplaceResources(
  input: SyncProjectMarketplaceResourcesInput,
  ipcInvoke: ResourceIpcInvoke = (channel, payload) => window.agentDesktop.ipcInvoke(channel, payload),
) {
  const skillIds = uniqueIds(input.skillIds);
  const expertIds = uniqueIds(input.expertIds);
  if (skillIds.length === 0 && expertIds.length === 0) return;

  input.onProgress?.('正在检查本地技能和专家...');
  const [installedSkillResult, installedExpertResult] = await Promise.all([
    ipcInvoke('public-skillhub:get-installed-skills') as Promise<ResourceResponse>,
    ipcInvoke('public-experthub:get-installed-experts') as Promise<ResourceResponse>,
  ]);
  if (!installedSkillResult?.success) {
    throw new Error(responseError(installedSkillResult, '读取本地技能失败'));
  }
  if (!installedExpertResult?.success) {
    throw new Error(responseError(installedExpertResult, '读取本地专家失败'));
  }

  const skillKeys = installedKeys(responseDataArray(installedSkillResult), addInstalledSkillKeys);
  const expertKeys = installedKeys(responseDataArray(installedExpertResult), addInstalledExpertKeys);
  const missingSkillIds = skillIds.filter((id) => !skillKeys.has(resourceKey(id)));
  const missingExpertIds = expertIds.filter((id) => !expertKeys.has(resourceKey(id)));

  for (const [index, skillId] of missingSkillIds.entries()) {
    input.onProgress?.(`正在安装技能 ${index + 1}/${missingSkillIds.length}...`);
    const coordinate = parseSkillCoordinate(skillId);
    const detailResult = await ipcInvoke('public-skillhub:fetch-detail', coordinate) as ResourceResponse;
    const detailData = record(detailResult?.data);
    const skill = record(detailData?.skill);
    if (!detailResult?.success || !skill) {
      throw new Error(`技能“${skillId}”信息获取失败：${responseError(detailResult, '市场中未找到该技能')}`);
    }
    const installResult = await ipcInvoke('public-skillhub:install-skill', { skill }) as ResourceResponse;
    if (!installResult?.success) {
      throw new Error(`技能“${skillId}”安装失败：${responseError(installResult, '未知错误')}`);
    }
    addInstalledSkillKeys(skillKeys, skill);
  }

  for (const [index, expertId] of missingExpertIds.entries()) {
    input.onProgress?.(`正在安装专家 ${index + 1}/${missingExpertIds.length}...`);
    const installResult = await ipcInvoke('public-experthub:install-expert', { expertId }) as ResourceResponse;
    if (!installResult?.success) {
      throw new Error(`专家“${expertId}”安装失败：${responseError(installResult, '未知错误')}`);
    }
  }
}
