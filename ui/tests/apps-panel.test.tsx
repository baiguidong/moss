import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppInstanceRow } from '../src/renderer-react/components/apps-panel';
import { AppMarketplacePanel } from '../src/renderer-react/components/app-marketplace-panel';
import type { AppInstance, StoredApp } from '../src/renderer-react/types';

function renderInstance(hasSettings: boolean) {
  const app = {
    id: 'moss.feishu',
    name: 'feishu',
    hasSettings,
    enabled: true,
    backend: {
      lifecycle: 'persistent',
      instanceMode: 'single',
      targets: ['desktop'],
      configuration: {
        schema: {
          type: 'object',
          properties: {
            appId: { type: 'string', title: '飞书 App ID' },
            allowedUsers: { type: 'array', title: 'allowedUsers' },
          },
        },
      },
    },
    deployments: [{
      deployment: { instanceId: 'moss.feishu--default', targetType: 'desktop' },
      runtime: { state: 'running' },
    }],
  } as StoredApp;
  const instance = {
    id: 'moss.feishu--default',
    displayName: 'Default',
    target: 'desktop',
    enabled: true,
    config: { appId: 'cli_example', allowedUsers: [] },
    secretRefs: { appSecret: { configured: true } },
  } as AppInstance;

  return renderToStaticMarkup(
    <AppInstanceRow app={app} instance={instance} onChanged={async () => {}} />,
  );
}

describe('Apps management', () => {
  test('renders an accessible marketplace loading shell', () => {
    const markup = renderToStaticMarkup(
      <AppMarketplacePanel installedApps={[]} onBack={() => {}} onInstalled={async () => {}} />,
    );

    expect(markup).toContain('应用市场');
    expect(markup).toContain('placeholder="搜索 App"');
    expect(markup).toContain('title="返回已安装 App"');
    expect(markup).toContain('正在加载应用市场');
  });

  test('keeps runtime controls but removes duplicate settings for Apps with their own settings page', () => {
    const markup = renderInstance(true);

    expect(markup).toContain('默认实例');
    expect(markup).toContain('title="重启"');
    expect(markup).toContain('title="日志"');
    expect(markup).not.toContain('配置实例');
    expect(markup).not.toContain('飞书 App ID');
    expect(markup).not.toContain('allowedUsers');
    expect(markup).not.toContain('保存配置');
  });

  test('keeps the instance settings entry for Apps without a settings page', () => {
    expect(renderInstance(false)).toContain('title="配置实例"');
  });
});
