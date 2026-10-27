import * as React from 'react';
import { Button } from '@/components/ui/button';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import type { DesktopSettings } from '../types';

type Settings = Pick<DesktopSettings, 'model' | 'url' | 'apiKey' | 'thinkingMode' | 'thinkingBudgetTokens'>;
type Result = Awaited<ReturnType<Window['agentDesktop']['testModel']>>;

export function ModelConnectionTest({ settings }: { settings: Settings }) {
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState<{ key: string; value: Result } | null>(null);
  const key = JSON.stringify([settings.model, settings.url, settings.apiKey, settings.thinkingMode, settings.thinkingBudgetTokens]);
  const visible = result?.key === key ? result.value : null;
  const test = async () => {
    setRunning(true);
    setResult(null);
    const { model, url, apiKey, thinkingMode, thinkingBudgetTokens } = settings;
    try {
      const value = await window.agentDesktop.testModel({ model, url, apiKey, thinkingMode, thinkingBudgetTokens });
      setResult({ key, value });
    } catch (error) {
      setResult({ key, value: { ok: false, status: null, durationMs: 0, thinking: thinkingMode, message: cleanIpcErrorMessage(error) } });
    } finally {
      setRunning(false);
    }
  };
  return <div className="flex w-full flex-col items-start gap-2 sm:items-end">
    <Button variant="outline" size="sm" disabled={running || !settings.model.trim() || !settings.url.trim()} onClick={test}>
      {running ? '测试中…' : '测试当前配置'}
    </Button>
    {visible && <div role={visible.ok ? 'status' : 'alert'} className={`w-full whitespace-pre-wrap break-words text-xs leading-relaxed ${visible.ok ? 'text-muted-foreground' : 'text-destructive'}`}>
      <div>{visible.ok ? '测试成功' : '测试失败'}{visible.status ? ` · HTTP ${visible.status}` : ''}{visible.durationMs ? ` · ${(visible.durationMs / 1000).toFixed(1)} 秒` : ''}</div>
      <div>{visible.message}</div>
    </div>}
  </div>;
}
