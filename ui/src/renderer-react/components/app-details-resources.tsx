import type { StoredApp } from '@/types';
import { AppDetailsSection, APP_DETAILS_LIST_CLASS, APP_DETAILS_ROW_CLASS } from './app-details-section';

/** Describe declared capabilities without loading resources or mounting App views. */
export function AppDetailsResources({ app }: { app: StoredApp }) {
  const resources = [
    ...(app.contributes?.resourceProviders || []).map(provider => ({
      key: `resource/${provider.id}`, title: provider.title || '应用资源', permission: provider.permission,
      description: [
        provider.listAction ? '可浏览、选择资源并在主会话引用。' : '可在主会话引用应用资源。',
        provider.authoring?.intents?.includes('create') ? '支持在主会话创建。' : '',
        provider.authoring?.intents?.includes('edit') ? '支持在主会话修改。' : '',
      ].filter(Boolean).join(''),
    })),
    ...(app.contributes?.widgets || []).map(widget => ({
      key: `widget/${widget.id}`, title: widget.title, permission: widget.permission,
      description: widget.placement === 'overlay' ? '通过悬浮组件展示内容。' : '通过状态组件展示内容。',
    })),
  ];
  if (!resources.length) return null;
  return <AppDetailsSection title="资源与展示能力" count={resources.length}>
    <div className={APP_DETAILS_LIST_CLASS}>
      {resources.map(resource => <article key={resource.key} className={APP_DETAILS_ROW_CLASS}>
        <div className="min-w-0 flex-1"><h3 className="break-words font-medium">{resource.title}</h3><p className="mt-1 text-xs leading-6 text-muted-foreground">{resource.description}</p></div>
        <span className="shrink-0 text-xs leading-6 text-muted-foreground">{!app.enabled ? 'App 已停用' : resource.permission && !app.grants?.includes(resource.permission) ? '未授权' : '已提供'}</span>
      </article>)}
    </div>
  </AppDetailsSection>;
}
