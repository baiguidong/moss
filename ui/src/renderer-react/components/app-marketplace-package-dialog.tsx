import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { AppMarketplaceVersion } from '@/types';

export type MarketPackageType = 'online' | 'full';
type Choice = MarketPackageType | 'download';

const platformNames: Record<string, string> = {
  'darwin-arm64': 'macOS · Apple Silicon', 'darwin-x64': 'macOS · Intel',
  'win32-x64': 'Windows · x64', 'win32-arm64': 'Windows · ARM64',
  'linux-x64': 'Linux · x64', 'linux-arm64': 'Linux · ARM64',
};

export function packageSize(bytes: number) {
  return bytes >= 1024 ** 2 ? `${(bytes / 1024 ** 2).toFixed(1)} MiB` : `${Math.ceil(bytes / 1024)} KiB`;
}

export function AppMarketplacePackageDialog({ name, release, hostPlatform, canInstall, action, onClose, onInstall, onDownload }: {
  name: string; release: AppMarketplaceVersion; hostPlatform?: string; canInstall: boolean; action: string;
  onClose(): void; onInstall(type: MarketPackageType): void; onDownload(target: string): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const kits = release.offlineKits || {};
  const targets = Object.keys(kits);
  const localKit = hostPlatform ? kits[hostPlatform] : undefined;
  const [target, setTarget] = useState(localKit ? hostPlatform! : targets[0]);
  const [choice, setChoice] = useState<Choice>(canInstall ? 'online' : 'download');
  const submit = choice === 'download' ? '下载' : action;
  useEffect(() => {
    dialog.current?.showModal();
    dialog.current?.querySelector<HTMLInputElement>('input:checked')?.focus();
  }, []);

  const dismiss = () => {
    dialog.current?.close();
    onClose();
  };
  const choices: { value: Choice; label: string; size?: number; description: string; available: boolean }[] = [
    { value: 'full', label: '完整包', size: localKit?.size, available: canInstall && !!localKit,
      description: localKit ? '安装到本机，包含离线资源。' : '当前平台暂无完整包。' },
    { value: 'online', label: '在线包', size: release.artifact?.size, available: canInstall,
      description: '安装到本机，首次使用时联网准备资源。' },
    { value: 'download', label: '下载', size: kits[target]?.size, available: !!kits[target],
      description: '仅保存完整包，可带到其他电脑离线安装。' },
  ];
  return <dialog ref={dialog} aria-labelledby={title} onCancel={event => { event.preventDefault(); dismiss(); }}
    className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-md rounded-xl border border-border bg-card p-5 text-foreground shadow-2xl backdrop:bg-black/40">
    <form onSubmit={event => {
      event.preventDefault();
      dismiss();
      if (choice === 'download') onDownload(target); else onInstall(choice);
    }}>
      <h2 id={title} className="text-lg font-semibold">{canInstall ? '选择' + action + '方式' : '下载完整包'}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{name} · v{release.version}</p>
      <fieldset aria-label="安装包" className="mt-5 grid gap-2">
        {choices.filter(item => canInstall || item.value === 'download').map(item => <label key={item.value}
          className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 has-checked:border-primary has-checked:bg-primary/5 has-disabled:cursor-default has-disabled:opacity-50">
          <input type="radio" name="package-type" value={item.value} checked={choice === item.value} disabled={!item.available}
            onChange={() => setChoice(item.value)} className="mt-1 accent-primary" />
          <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3 text-sm font-medium">{item.label}
            {item.size && <span className="text-xs font-normal tabular-nums text-muted-foreground">{packageSize(item.size)}</span>}</span>
            <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.description}</span></span>
        </label>)}
      </fieldset>
      {choice === 'download' && <label className="mt-3 flex items-center justify-between gap-3 text-sm">目标平台
        <select value={target} onChange={event => setTarget(event.target.value)} className="h-8 rounded-md border border-input bg-background px-2">
          {targets.map(item => <option key={item} value={item}>{platformNames[item] || item}</option>)}
        </select></label>}
      <div className="mt-5 flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={dismiss}>取消</Button>
        <Button type="submit">{submit}</Button>
      </div>
    </form>
  </dialog>;
}
