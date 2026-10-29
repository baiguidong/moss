import { useEffect, useRef } from 'react';
import { ArrowLeft, ChevronRight, Download, LoaderCircle, PackageCheck } from 'lucide-react';
import { AppMarketplaceIcon } from '@/components/app-marketplace-icon';
import { AppDetailsSection, APP_DETAILS_LIST_CLASS, APP_DETAILS_ROW_CLASS } from '@/components/app-details-section';
import { AppInstallProgressView } from '@/components/app-install-progress';
import { Button } from '@/components/ui/button';
import { supportsHostFeature } from '@/lib/host-environment';
import { describeAppPermission } from '../../shared/app-capability-descriptions.mjs';
import type { AppInstallProgress, AppMarketplaceDetail, AppMarketplaceEntry, StoredApp } from '@/types';

export function AppMarketplaceDetails({ entry, detail, installed, version, busy, progress, error, detailError, hostApiVersion, onBack, onInstall, onVersion, onRetry }: {
  entry: AppMarketplaceEntry; detail?: AppMarketplaceDetail; installed?: StoredApp;
  version: string; busy: boolean; progress?: AppInstallProgress; error?: string; detailError?: string; hostApiVersion?: string;
  onBack(): void; onInstall(): void; onVersion(version: string): void; onRetry(): void;
}) {
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { backButton.current?.focus({ preventScroll: true }); }, []);
  const release = detail?.versions.find(item => item.version === version) || entry.latest;
  const compatible = (release.platformCompatible ?? entry.platformCompatible) && (release.hostCompatible ?? entry.hostCompatible);
  const sameVersion = installed?.currentVersion === version;
  const localModification = Boolean(installed?.localModification || entry.localModification);
  const action = busy ? installed ? '更新中…' : '安装中…' : !installed ? '安装' : localModification ? sameVersion ? '本地版本冲突' : '安装市场版'
    : sameVersion ? '已安装' : version === entry.latestVersion && entry.updateAvailable ? '更新' : '安装此版本';
  const installSupported = supportsHostFeature('appInstallation');
  const bytes = release.artifact?.size || 0;
  const size = bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return <div data-app-market-details={entry.id} className="h-full min-h-0 overflow-y-auto bg-background">
    <div className="@container mx-auto max-w-3xl space-y-8 px-5 pb-12 pt-4 sm:px-9">
      <nav aria-label="市场详情导航" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Button ref={backButton} variant="ghost" size="sm" className="-ml-2 gap-1.5 px-2" disabled={busy} onClick={onBack}><ArrowLeft className="h-4 w-4" />应用市场</Button>
        <ChevronRight className="h-3.5 w-3.5" /><span className="truncate text-foreground">{entry.displayName}</span>
      </nav>
      <header className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-4 @2xl:grid-cols-[auto_minmax(0,1fr)_auto]">
        <AppMarketplaceIcon icon={entry.iconUrl} className="h-16 w-16 rounded-2xl" />
        <div className="min-w-0"><h1 className="text-2xl font-semibold tracking-tight">{entry.displayName}</h1><p className="mt-1.5 text-sm text-muted-foreground">{entry.publisher?.name || '应用市场'} · {entry.summary}</p></div>
        <Button className="col-span-2 w-fit rounded-full @2xl:col-span-1" disabled={busy || !detail || sameVersion || !compatible || !installSupported} onClick={onInstall}>
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : sameVersion && !localModification ? <PackageCheck className="h-4 w-4" /> : <Download className="h-4 w-4" />}
          {installSupported ? action : '此 Host 暂不支持安装授权'}
        </Button>
      </header>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {progress && <AppInstallProgressView progress={progress} />}
      {detailError ? <p role="alert" className="text-sm text-destructive">{detailError}<Button variant="outline" size="sm" className="ml-3 rounded-full" onClick={onRetry}>重试</Button></p>
        : !detail ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" />正在读取详情…</p> : null}
      {detail?.description && <p className="whitespace-pre-wrap text-sm leading-7">{detail.description}</p>}
      {!compatible && <p role="alert" className="text-sm text-destructive">{!(release.platformCompatible ?? entry.platformCompatible) ? '此版本不支持当前系统' : `此版本需要 Host API ${release.hostApi}，当前为 ${hostApiVersion}`}</p>}
      {localModification && <p className="text-sm leading-7 text-muted-foreground">{sameVersion
        ? '本地修改与市场版本号相同，请保留源码并卸载本地版本后再安装。'
        : '当前为本地修改版本。确认安装市场版后，本地版本和源码仍保留，可在版本历史中回滚。'}</p>}
      <AppDetailsSection title="基本信息"><dl className={APP_DETAILS_LIST_CLASS}>
        <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">版本</dt><dd>{detail ? <select aria-label="可用版本" className="h-9 max-w-full rounded-lg border border-input bg-background px-3 text-sm" value={version} disabled={busy} onChange={event => onVersion(event.target.value)}>
          {detail.versions.filter(item => item.platformCompatible).map(item => <option key={item.version} value={item.version}>{item.version}</option>)}
        </select> : version}</dd></div>
        {installed && <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">已安装版本</dt><dd>{installed.currentVersion}{['invalid', 'incompatible'].includes(installed.packageStatus || '') ? ' · 当前版本不可用' : ''}</dd></div>}
        <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">开发者</dt><dd>{entry.publisher?.name || '未提供'}</dd></div>
        <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">安装包</dt><dd>{release.artifact ? size : '无适用安装包'}</dd></div>
        <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">签名</dt><dd>{release.artifact?.signed ? '已签名' : '未签名'}</dd></div>
        <div className={APP_DETAILS_ROW_CLASS}><dt className="text-muted-foreground">Host API</dt><dd>{release.hostApi}</dd></div>
      </dl></AppDetailsSection>
      {release.releaseNotes && <AppDetailsSection title="更新说明"><p className="whitespace-pre-wrap py-4 text-sm leading-7">{release.releaseNotes}</p></AppDetailsSection>}
      {release.permissions.length > 0 && <AppDetailsSection title="所需权限"><dl className={APP_DETAILS_LIST_CLASS}>
        {release.permissions.map(permission => { const info = describeAppPermission(permission); return <div key={permission} className="space-y-1 py-4 text-sm"><dt className="font-medium">{info.label}</dt><dd className="text-muted-foreground">{info.description}<code className="mt-1 block break-all text-xs">{permission}</code></dd></div>; })}
      </dl></AppDetailsSection>}
    </div>
  </div>;
}
