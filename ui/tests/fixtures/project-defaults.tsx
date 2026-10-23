import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectAppDefaultsPicker } from '@/components/projects/project-app-defaults';
import { appServiceKey } from '../../../packages/app-sdk/src/tool-services.mjs';
import type { StoredApp } from '@/types';
import '@/globals.css';
const app = { id: 'customer.app', name: 'customer.app', displayName: '客户服务', enabled: true, toolSelection: 'services',
  contributes: { services: [{ id: 'sales', title: '销售数据' }, { id: 'support', title: '客户支持' }] },
  agentTools: [{ id: 'read-sales', serviceId: 'sales' }, { id: 'read-support', serviceId: 'support' }],
} as unknown as StoredApp;
function Fixture() {
  const [value, setValue] = React.useState({ appIds: [], appServiceIds: [appServiceKey('customer.app', 'sales')] });
  return <main className="p-6"><ProjectAppDefaultsPicker apps={[app]} value={value} onChange={setValue} /><output data-selection>{JSON.stringify(value)}</output></main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
