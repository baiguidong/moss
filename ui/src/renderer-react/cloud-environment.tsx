import { createRoot } from 'react-dom/client';
import { CloudSnapshots } from './components/cloud-snapshots';
import { showWebLogin } from './web-interface';
import { applyAppearanceTheme, readCachedAppearance } from './theme/appearance';
import './globals.css';
export async function mountCloudEnvironment() {
  const appearance = readCachedAppearance();
  const themeMode = appearance.themeMode;
  const theme = themeMode === 'dark' || (themeMode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.style.colorScheme = theme;
  applyAppearanceTheme(appearance);
  const response = await fetch('/api/auth?management=1', { credentials: 'same-origin' }), auth = await response.json();
  if (!auth.authenticated) await showWebLogin(auth.mode, async values => {
    const result = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, management: true }) });
    const value = await result.json(); if (!result.ok) throw new Error(value.error); return value;
  });
  if (!auth.managed) throw new Error('此 Web Host 没有 Docker 环境控制器');
  createRoot(document.getElementById('root')!).render(<main className="min-h-screen bg-muted/30 p-4 sm:p-8"><div className="mx-auto max-w-4xl"><CloudSnapshots standalone /></div></main>);
}
