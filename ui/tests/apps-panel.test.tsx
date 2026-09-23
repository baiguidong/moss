import { afterEach, describe, expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AppRuntimeControls, AppsPanel, setAppEnabled } from '../src/renderer-react/components/apps-panel';
import { AppMarketplacePanel } from '../src/renderer-react/components/app-marketplace-panel';
import type { AppInstance, StoredApp } from '../src/renderer-react/types';

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
afterEach(() => {
  if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
  else Reflect.deleteProperty(globalThis, 'window');
});

function settingsApp(hasSettings = true) {
  return {
    id: 'example.settings',
    name: 'example.settings',
    hasUi: hasSettings,
    hasSettings,
    enabled: false,
    backend: { lifecycle: 'persistent' },
    configuration: {
      schema: {
        type: 'object',
        required: ['appId'],
        properties: {
          appId: { type: 'string', title: 'Example App ID' },
          allowedUsers: { type: 'array', title: 'allowedUsers' },
        },
      },
      secrets: { required: ['appSecret'], properties: { appSecret: { title: 'App Secret' } } },
    },
    instances: [{ id: 'example.settings--default', displayName: 'Default', enabled: false, config: {}, secretRefs: {} }],
  } as StoredApp;
}

function renderInstance(hasSettings: boolean, enabled = true) {
  const app = {
    ...settingsApp(hasSettings),
    enabled,
  } as StoredApp;
  const instance = {
    id: 'example.settings--default',
    displayName: 'Default',
    enabled,
    status: { state: 'running' },
    config: { appId: 'cli_example', allowedUsers: [] },
    secretRefs: { appSecret: { configured: true } },
  } as AppInstance;

  return renderToStaticMarkup(
    <AppRuntimeControls app={app} instance={instance} onChanged={async () => {}} onOpenSettings={() => {}} />,
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

  test('uses the App settings page instead of duplicating single-instance configuration', () => {
    const markup = renderInstance(true);

    expect(markup).not.toContain('默认实例');
    expect(markup).toContain('title="重启"');
    expect(markup).toContain('title="日志"');
    expect(markup).not.toContain('title="配置实例"');
    expect(markup).toContain('title="打开应用设置"');
    expect(markup).not.toContain('Example App ID');
    expect(markup).not.toContain('allowedUsers');
    expect(markup).not.toContain('保存配置');
    expect(markup).not.toContain('role="switch"');
  });

  test('shows App configuration directly when there is no custom settings page', () => {
    const markup = renderInstance(false);
    expect(markup).toContain('Example App ID');
    expect(markup).toContain('保存配置');
    expect(markup).not.toContain('实例名称');
    expect(markup).not.toContain('role="switch"');
  });

  test('allows an unconfigured single-instance App to enable its own settings UI', async () => {
    const app = settingsApp();
    const calls: unknown[] = [];
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agentDesktop: {
      setAppEnabled: async (payload: unknown) => { calls.push(payload); },
      setAppInstanceEnabled: async () => { throw new Error('Unconfigured Backend must not be started'); },
    } } });

    await setAppEnabled(app, true);
    expect(calls).toEqual([{ appId: app.id, enabled: true }]);
    app.enabled = true;
    const markup = renderToStaticMarkup(<AppsPanel apps={[app]} versionsByApp={{}} onLaunch={() => {}} onDelete={() => {}} onIterate={() => {}} onLoadVersions={() => {}} onRollback={() => {}} onRefresh={async () => {}} />);
    expect(markup).toMatch(/role="switch"[^>]*checked=""/);
    const openButton = markup.match(/<button[^>]*data-app-open="example\.settings"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
    expect(openButton).toContain('打开');
    expect(openButton).not.toContain('disabled=""');
    expect(markup).not.toContain('加入侧栏');
    expect(markup).not.toContain('移出侧栏');
  });

  test('still enables a configured default instance and restores it when App enabling fails', async () => {
    const app = settingsApp();
    app.instances![0].config = { appId: 'cli_example' };
    app.instances![0].secretRefs = { appSecret: { configured: true, masked: '****' } };
    const calls: unknown[] = [];
    Object.defineProperty(globalThis, 'window', { configurable: true, value: { agentDesktop: {
      setAppEnabled: async () => { throw new Error('Unable to enable App'); },
      setAppInstanceEnabled: async (payload: unknown) => { calls.push(payload); },
    } } });

    await expect(setAppEnabled(app, true)).rejects.toThrow('Unable to enable App');
    expect(calls).toEqual([
      { appId: app.id, instanceId: app.instances![0].id, enabled: true },
      { appId: app.id, instanceId: app.instances![0].id, enabled: false },
    ]);
  });

  test('keeps required configuration checks for Apps using the host form', async () => {
    await expect(setAppEnabled(settingsApp(false), true)).rejects.toThrow('请先打开应用管理并保存必填项');
  });

  test('does not show a stale running state for a disabled host and instance', () => {
    const markup = renderInstance(true, false);
    expect(markup).not.toContain('运行中');
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

  test('keeps an incompatible installed App visible and directs the user to update it', () => {
    const app = {
      id: 'example.legacy',
      name: 'example.legacy',
      displayName: 'Legacy App',
      title: 'Legacy App',
      description: 'Installed with an older Host API.',
      icon: '',
      width: 800,
      height: 600,
      resizable: true,
      createdAt: 1,
      updatedAt: 2,
      currentVersion: '1.3.0',
      packageStatus: 'incompatible',
      packageError: 'App requires Host API ^1.3.0; this Host provides 2.0.0',
      requiredHostApi: '^1.3.0',
      hasUi: true,
      hasBackend: false,
      enabled: false,
      permissions: [],
      instances: [],
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

    expect(markup).toContain('Legacy App');
    expect(markup).toContain('当前安装的 v1.3.0 需要 Host API ^1.3.0，与此版本 Moss 不兼容，请更新到兼容版本。');
    expect(markup).toContain('更新版本');
    const openButton = markup.match(/<button[^>]*data-app-open="example\.legacy"[^>]*>[\s\S]*?<\/button>/)?.[0] || '';
    expect(openButton).toContain('disabled=""');
    expect(openButton).toContain('不可用');
  });
});
