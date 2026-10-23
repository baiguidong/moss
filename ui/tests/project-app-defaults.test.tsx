import { expect, test } from 'bun:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProjectAppDefaultsPicker, setProjectAppServices } from '../src/renderer-react/components/projects/project-app-defaults';
import { createSessionApps } from '../src/apps/session-apps.mjs';
import { resolveProjectSessionDefaults } from '../src/shared/project-session-defaults.mjs';
import { appServiceKey } from '../../packages/app-sdk/src/tool-services.mjs';
import type { StoredApp } from '../src/renderer-react/types';

const app = {
  id: 'customer.app', name: 'customer.app', displayName: '客户服务', enabled: true, toolSelection: 'services',
  contributes: { services: [{ id: 'sales', title: '销售数据' }, { id: 'support', title: '客户支持' }] },
  agentTools: [{ id: 'read-sales', serviceId: 'sales' }, { id: 'read-support', serviceId: 'support' }],
} as unknown as StoredApp;
const key = (id: string) => appServiceKey(app.id!, id);

test('saved service selections remain visible and removable even when an App is disabled or removed', () => {
  const value = { appIds: [], appServiceIds: [key('sales')] };
  const html = renderToStaticMarkup(<ProjectAppDefaultsPicker apps={[{ ...app, enabled: false }]} value={value} onChange={() => {}} />);
  expect(html).toContain('客户服务 / 销售数据');
  expect(html).toContain('aria-label="移除 客户服务 / 销售数据"');
  const missing = renderToStaticMarkup(<ProjectAppDefaultsPicker apps={[]} value={value} onChange={() => {}} />);
  expect(missing.replaceAll('&quot;', '"')).toContain(`移除 ${key('sales')}`);
});

test('project service edits round-trip through ordinary session validation and preserve other Apps', async () => {
  const service = createSessionApps({
    getRuntime: () => ({ installations: new Map([[app.id, { enabled: true }]]),
      getActivePackage: async () => ({ manifest: app }), listContributions: async () => ({ tools: app.agentTools }) }),
    getMcpHost: () => ({ toolCatalog: () => [] }), isBusy: () => false, disposeRuntime() {}, persist() {}, emit() {},
  });
  const migrated = await service.validateSelection({ appIds: [app.id], appServiceIds: [] });
  expect(migrated.appIds).toEqual([]);
  expect(migrated.appServiceIds).toEqual([key('sales'), key('support')]);
  const edited = setProjectAppServices(migrated, app.id!, [key('support')]);
  const project = { id: 'p', ...await service.validateSelection(edited, migrated) };
  const first = resolveProjectSessionDefaults(project, {}, {}, '/p');
  expect(first.appServiceIds).toEqual([key('support')]);
  const cleared = setProjectAppServices(project, app.id!, []);
  expect(await service.validateSelection(cleared, project)).toEqual({ appIds: [], appServiceIds: [] });
  expect(first.appServiceIds).toEqual([key('support')]);
  expect(setProjectAppServices({ appIds: ['another'], appServiceIds: [key('sales')] }, app.id!, [])).toEqual({ appIds: ['another'], appServiceIds: [] });
});
