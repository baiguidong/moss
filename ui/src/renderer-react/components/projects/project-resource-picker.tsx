import * as React from 'react';
import {
  AppWindow,
  Bot,
  Check,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectionPickerDialog } from '@/components/selection-picker-dialog';
import { cn } from '@/lib/utils';

type ProjectResourceKind = 'skill' | 'expert' | 'app';
type Resource = import('@/types').ProjectCreationDraft['resources'][number] & { icon?: string; runtimeId?: string };

type ProjectResourceOption = {
  id: string;
  name: string;
  description: string;
  icon?: string;
  meta?: string;
  resource?: Resource;
};

type ProjectResourcePage = {
  items: ProjectResourceOption[];
  total: number;
  hasMore: boolean;
  warning?: string;
};

type ProjectResourcePickerProps = {
  kind: ProjectResourceKind;
  title: string;
  description?: string;
  disabled?: boolean;
  initialResources?: Resource[];
  onResourceSelect?: (resource: Resource) => void;
  selectedIds: string[];
  multiple?: boolean;
  onChange: (ids: string[]) => void;
};

const PAGE_SIZE = 50;

function uniqueOptions(items: ProjectResourceOption[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function toOption(resource: Resource): ProjectResourceOption {
  return { id: resource.id, name: resource.displayName || resource.id, description: resource.description || '', icon: resource.icon,
    meta: resource.installed ? resource.status === 'disabled' ? '待启用' : '已安装' : '待安装', resource };
}

async function loadResources(kind: ProjectResourceKind, query: string, page: number): Promise<ProjectResourcePage> {
  const result = await window.agentDesktop.projectResources({ kind, query, page, pageSize: PAGE_SIZE });
  return { items: result.resources.map(toOption), total: result.total, hasMore: result.hasMore, warning: result.warning };
}

function resourceCopy(kind: ProjectResourceKind) {
  if (kind === 'app') return { action: '选择', pickerTitle: '选择 App', searchPlaceholder: '搜索 App', emptyLabel: '没有匹配的 App' };
  if (kind === 'skill') {
    return {
      action: '选择',
      pickerTitle: '选择技能',
      searchPlaceholder: '搜索技能',
      emptyLabel: '没有匹配的技能',
    };
  }
  return {
    action: '选择',
    pickerTitle: '选择专家',
    searchPlaceholder: '搜索专家',
    emptyLabel: '没有匹配的专家',
  };
}

function ResourceIcon({ kind, option }: { kind: ProjectResourceKind; option?: ProjectResourceOption }) {
  const [failed, setFailed] = React.useState(false);
  if (option?.icon && !failed) {
    return (
      <img
        src={option.icon}
        alt=""
        className="h-5 w-5 object-contain"
        onError={() => setFailed(true)}
      />
    );
  }
  if (kind === 'app') return <AppWindow className="h-4 w-4" />;
  if (kind === 'skill') return <Sparkles className="h-4 w-4" />;
  return <Bot className="h-4 w-4" />;
}

export function ProjectResourcePicker({
  kind,
  title,
  description,
  disabled = false,
  initialResources,
  onResourceSelect,
  selectedIds,
  multiple = true,
  onChange,
}: ProjectResourcePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState<ProjectResourceOption[]>([]);
  const [knownItems, setKnownItems] = React.useState<Record<string, ProjectResourceOption>>(() => Object.fromEntries((initialResources || []).map(resource => [resource.id, toOption(resource)])));
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState('');
  const requestIdRef = React.useRef(0);
  const copy = resourceCopy(kind);
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  const rememberItems = React.useCallback((nextItems: ProjectResourceOption[]) => {
    setKnownItems((current) => {
      const next = { ...current };
      for (const item of nextItems) next[item.id] = item;
      return next;
    });
  }, []);

  const selectedKey = selectedIds.join('\0');
  React.useEffect(() => {
    let disposed = false;
    void Promise.allSettled(selectedIds.map(id => window.agentDesktop.projectResources({ kind, action: 'inspect', id })))
      .then(results => { if (!disposed) rememberItems(results.flatMap(result => result.status === 'fulfilled' ? [toOption(result.value)] : [])); });
    return () => { disposed = true; };
  }, [kind, selectedKey, rememberItems]);

  React.useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoadingMore(false);
    if (!open) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void loadResources(kind, query, 1)
        .then((result) => {
          if (requestIdRef.current !== requestId) return;
          setItems(result.items);
          rememberItems(result.items);
          setPage(1);
          setTotal(result.total);
          setHasMore(result.hasMore);
          setError(result.warning || '');
        })
        .catch((err) => {
          if (requestIdRef.current !== requestId) return;
          setItems([]);
          setTotal(0);
          setHasMore(false);
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (requestIdRef.current === requestId) setLoading(false);
        });
    }, query ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [kind, open, query, rememberItems]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    const requestId = requestIdRef.current;
    const nextPage = page + 1;
    setLoadingMore(true);
    setError('');
    try {
      const result = await loadResources(kind, query, nextPage);
      if (requestIdRef.current !== requestId) return;
      setItems((current) => uniqueOptions([...current, ...result.items]));
      rememberItems(result.items);
      setPage(nextPage);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setError(result.warning || '');
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestIdRef.current === requestId) setLoadingMore(false);
    }
  };

  const toggle = (id: string) => {
    if (disabled) return;
    const resource = knownItems[id]?.resource;
    if (!selected.has(id) && resource) onResourceSelect?.(resource);
    onChange(selected.has(id)
      ? selectedIds.filter((entry) => entry !== id)
      : multiple ? [...selectedIds, id] : [id]);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="space-y-2.5 border-t border-border pt-5" data-project-resource-kind={kind}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          {description && <div className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</div>}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={disabled} onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" />
          {copy.action}
        </Button>
      </div>

      {selectedIds.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const option = knownItems[id];
            return (
              <span
                key={id}
                className="inline-flex min-w-0 max-w-[240px] items-center gap-1.5 rounded-md border border-border bg-muted/30 px-2 py-1 text-xs text-foreground"
                title={option?.description || id}
              >
                <ResourceIcon kind={kind} option={option} />
                <span className="truncate">{option?.name || id}</span>
                <button
                  type="button"
                  className="shrink-0 text-muted-foreground hover:text-foreground"
                  onClick={() => toggle(id)}
                  aria-label={`移除 ${option?.name || id}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            );
          })}
        </div>
      ) : null}

      <SelectionPickerDialog
        open={open}
        title={copy.pickerTitle}
        description={`已选 ${selected.size} 个${total > 0 ? `，当前范围共 ${total} 个` : ''}`}
        searchPlaceholder={copy.searchPlaceholder}
        query={query}
        onQueryChange={setQuery}
        onClose={close}
        icon={<ResourceIcon kind={kind} />}
        resultCount={items.length}
        totalCount={total}
        emptyLabel={loading ? '正在加载...' : error || copy.emptyLabel}
        managerLabel=""
        confirmLabel="确定"
        onConfirm={close}
      >
        <div className="space-y-1">
          {items.map((option) => {
            const isSelected = selected.has(option.id);
            return (
              <button
                key={option.id}
                type="button"
                disabled={disabled}
                aria-pressed={isSelected}
                onClick={() => toggle(option.id)}
                className={cn(
                  'flex min-h-14 w-full items-center gap-3 rounded-md px-3 py-2 text-left transition-colors',
                  isSelected ? 'bg-primary/10' : 'hover:bg-muted',
                )}
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground">
                  <ResourceIcon kind={kind} option={option} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{option.name}</span>
                  <span className="mt-0.5 block line-clamp-2 text-xs leading-4 text-muted-foreground">
                    {option.description || option.meta || option.id}
                  </span>
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{option.meta}</span>
                <span className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded border',
                  isSelected ? 'border-primary bg-primary text-primary-foreground' : 'border-border',
                )}>
                  {isSelected ? <Check className="h-3.5 w-3.5" /> : null}
                </span>
              </button>
            );
          })}
          {error && items.length > 0 ? (
            <div className="px-3 py-2 text-xs text-destructive">{error}</div>
          ) : null}
          {hasMore ? (
            <div className="flex justify-center py-2">
              <Button type="button" variant="ghost" size="sm" disabled={loadingMore} onClick={loadMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                加载更多
              </Button>
            </div>
          ) : null}
        </div>
      </SelectionPickerDialog>
    </div>
  );
}
