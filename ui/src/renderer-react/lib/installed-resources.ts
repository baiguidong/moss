export type InstalledSkill = {
  id?: string;
  name?: string;
  displayName?: string;
  description?: string;
  version?: string;
  icon?: string;
  category?: string;
  categories?: string[];
  source?: string;
  isBuiltin?: boolean;
  isHubInstalled?: boolean;
  isUploaded?: boolean;
  enabled?: boolean;
  ownerName?: string;
  namespace?: { displayName?: string; handle?: string } | null;
};

export type InstalledExpertMember = {
  id?: string;
  name?: string;
  displayName?: string;
  profession?: string;
  role?: string;
  description?: string;
  promptFile?: string;
  localPromptFile?: string;
};

export type InstalledExpert = {
  id?: string;
  type?: 'agent' | 'team';
  name?: string;
  displayName?: string;
  profession?: string;
  description?: string;
  categoryName?: string;
  avatar?: string;
  plugin?: string;
  agentName?: string;
  tags?: string[];
  members?: InstalledExpertMember[];
  source?: string;
  sourceType?: string;
  installedAt?: string;
  enabled?: boolean;
  promptFile?: string;
  skills?: string[];
  quickPrompts?: string[];
};

export type InstalledResource =
  | { kind: 'skill'; item: InstalledSkill }
  | { kind: 'expert'; item: InstalledExpert };

export function installedResourceTitle(resource: InstalledResource) {
  return resource.item.displayName || resource.item.name || resource.item.id || (resource.kind === 'skill' ? '未命名技能' : '未命名专家');
}

export function installedResourceSource(resource: InstalledResource) {
  if (resource.kind === 'skill') {
    return resource.item.isBuiltin ? 'Moss 内置' : resource.item.isHubInstalled ? 'SkillHub' : resource.item.isUploaded ? '本地导入' : '本地技能';
  }
  const source = resource.item.sourceType;
  return !source || source === 'local' ? '本地专家' : ['experthub', 'workbuddy-expert-marketplace'].includes(source) ? '专家中心' : source;
}

/** Installed manifests use paths relative to their resource directory on both platforms. */
export function installedResourceFilePath(source: string | undefined, file: string) {
  if (!source) throw new Error('未找到安装目录，请刷新资源后重试。');
  const relative = file.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!relative || relative.startsWith('/') || relative.includes(':') || relative.split('/').includes('..')) {
    throw new Error('说明文件路径无效，请重新安装该资源。');
  }
  return `${source.replace(/\\/g, '/').replace(/\/+$/, '')}/${relative}`;
}
