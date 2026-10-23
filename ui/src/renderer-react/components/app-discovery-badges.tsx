import { getAppDiscovery, getAppKind, getAppToolCapabilities } from '@/lib/app-discovery';

export function AppDiscoveryBadges({ app }: { app: Parameters<typeof getAppDiscovery>[0] }) {
  const kind = getAppKind(app);
  const group = getAppDiscovery(app).group;
  const capabilities = getAppToolCapabilities(app);
  const labels = [kind === 'tool' ? '工具' : kind === 'app' ? '应用' : '',
    ...capabilities.map(capability => capability === 'skills' ? 'Skills' : capability.toUpperCase()),
    group === 'local' ? '本地' : group === 'online' ? '在线' : ''].filter(Boolean);
  return <span className="inline-flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-muted-foreground" data-app-kind={kind}>
    {labels.map(label => <span key={label}>{label}</span>)}
  </span>;
}
