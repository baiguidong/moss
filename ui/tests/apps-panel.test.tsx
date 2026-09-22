import { describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppInstanceRow, AppsPanel } from '../src/renderer-react/components/apps-panel';
import { AppMarketplacePanel } from '../src/renderer-react/components/app-marketplace-panel';
import type { AppInstance, StoredApp } from '../src/renderer-react/types';

function renderInstance(hasSettings: boolean, enabled = true) {
  const app = {
    id: 'example.settings',
    name: 'example.settings',
    hasSettings,
    enabled,
    backend: {
      lifecycle: 'persistent',
      instanceMode: 'single',
      targets: ['desktop'],
      configuration: {
        schema: {
          type: 'object',
          properties: {
            appId: { type: 'string', title: 'Example App ID' },
            allowedUsers: { type: 'array', title: 'allowedUsers' },
          },
        },
      },
    },
    deployments: [{
      deployment: { instanceId: 'example.settings--default', targetType: 'desktop' },
      runtime: { state: 'running' },
    }],
  } as StoredApp;
  const instance = {
    id: 'example.settings--default',
    displayName: 'Default',
    target: 'desktop',
    enabled,
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

  test('keeps instance configuration available for Apps with their own settings page', () => {
    const markup = renderInstance(true);

    expect(markup).toContain('默认实例');
    expect(markup).toContain('title="重启"');
    expect(markup).toContain('title="日志"');
    expect(markup).toContain('title="配置实例"');
    expect(markup).not.toContain('Example App ID');
    expect(markup).not.toContain('allowedUsers');
    expect(markup).not.toContain('保存配置');
  });

  test('keeps the instance settings entry for Apps without a settings page', () => {
    expect(renderInstance(false)).toContain('title="配置实例"');
  });

  test('does not show a stale running state for a disabled host and instance', () => {
    const markup = renderInstance(true, false);
    expect(markup).toContain('Desktop · 已停止');
    expect(markup).not.toContain('Desktop · 运行中');
  });

  test('prevents opening a disabled App and tells the user to enable it', () => {
    const app = {
      id: 'example.app',
      name: 'example.app',
      displayName: 'Example',
      currentVersion: '1.0.0',
      hasUi: true,
      hasBackend: false,
      enabled: false,
      permissions: [],
      instances: [],
      deployments: [],
    } as StoredApp;
    const markup = renderToStaticMarkup(
      <AppsPanel
        apps={[app]}
        versionsByApp={{}}
        onLaunch={() => {}}
        onDelete={() => {}}
        onIterate={() => {}}
        onLoadVersions={() => {}}
        onRollback={() => {}}
        onRefresh={async () => {}}
      />,
    );
    const openButton = markup.match(/<button[^>]*data-app-open="example\.app"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';

    expect(openButton).toContain('disabled=""');
    expect(openButton).toContain('title="请先启用 App"');
    expect(openButton).toContain('请先启用');
  });
});
