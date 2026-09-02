import * as React from 'react';
import {
  Bot,
  Cable,
  Check,
  Loader2,
  Plus,
  Sparkles,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SelectionPickerDialog } from '@/components/selection-picker-dialog';
import { isAuthorizedConnector } from '@/lib/connector-selection';
import { cn } from '@/lib/utils';
import type { InstalledConnector } from '@/types';

export type ProjectResourceKind = 'connector' | 'skill' | 'expert';

export type ProjectResourceOption = {
  id: string;
  name: string;
  description: string;
  icon?: string;
  meta?: string;
};

type ProjectResourcePage = {
  items: ProjectResourceOption[];
  total: number;
  hasMore: boolean;
};

type ProjectResourcePickerProps = {
  kind: ProjectResourceKind;
  title: string;
  description: string;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  options?: ProjectResourceOption[];
};

const PAGE_SIZE = 50;

function normalizeText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function uniqueOptions(items: ProjectResourceOption[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function matchesQuery(option: ProjectResourceOption, query: string) {
  const normalizedQuery = query.trim().toLocaleLowerCase('zh-Hans-CN');
  if (!normalizedQuery) return true;
  return [option.id, option.name, option.description, option.meta]
    .some((value) => String(value || '').toLocaleLowerCase('zh-Hans-CN').includes(normalizedQuery));
}

async function loadAuthorizedConnectors(query: string, page: number): Promise<ProjectResourcePage> {
  if (page > 1) return { items: [], total: 0, hasMore: false };
  const response = await window.agentDesktop.getInstalledConnectors();
  if (!response?.success) {
    throw new Error(response?.error || '读取已授权连接器失败');
  }
  const items = (Array.isArray(response.data) ? response.data : [])
    .filter(isAuthorizedConnector)
    .map((connector) => ({
      id: connector.id,
      name: connector.name || connector.id,
      description: connector.description || '',
      icon: connector.icon,
      meta: connector.type === 'mcp' ? 'MCP' : connector.type === 'cli' ? 'CLI' : '连接器',
    }))
    .filter((item) => matchesQuery(item, query))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
  return { items, total: items.length, hasMore: false };
}

async function loadMarketSkills(query: string, page: number): Promise<ProjectResourcePage> {
  const response = await window.agentDesktop.ipcInvoke('public-skillhub:fetch-skills', {
    page,
    pageSize: PAGE_SIZE,
    query,
    sortBy: 'downloads',
    order: 'desc',
  }) as {
    success?: boolean;
    data?: { skills?: Array<Record<string, unknown>>; total?: number; hasMore?: boolean };
    error?: string;
  };
  if (!response?.success) {
    throw new Error(response?.error || '读取技能市场失败');
  }
  const skills = Array.isArray(response.data?.skills) ? response.data.skills : [];
  const items = uniqueOptions(skills.map((skill) => {
    const id = normalizeText(skill.id) || normalizeText(skill.slug) || normalizeText(skill.name);
    return {
      id,
      name: normalizeText(skill.displayName) || normalizeText(skill.name) || id,
      description: normalizeText(skill.description),
      icon: normalizeText(skill.icon),
      meta: normalizeText(skill.category) || normalizeText(skill.ownerName) || '技能市场',
    };
  }));
  return {
    items,
    total: Number(response.data?.total) || items.length,
    hasMore: Boolean(response.data?.hasMore),
  };
}

async function loadMarketExperts(query: string, page: number): Promise<ProjectResourcePage> {
  const response = await window.agentDesktop.ipcInvoke('public-experthub:fetch-experts', {
    page,
    pageSize: PAGE_SIZE,
    query,
    type: 'all',
    sortBy: 'comprehensive',
  }) as {
    success?: boolean;
    data?: { experts?: Array<Record<string, unknown>>; total?: number; hasMore?: boolean };
    error?: string;
  };
  if (!response?.success) {
    throw new Error(response?.error || '读取专家市场失败');
  }
  const experts = Array.isArray(response.data?.experts) ? response.data.experts : [];
  const items = uniqueOptions(experts.map((expert) => {
    const id = normalizeText(expert.id) || normalizeText(expert.agentName) || normalizeText(expert.name);
    return {
      id,
      name: normalizeText(expert.displayName) || normalizeText(expert.name) || id,
      description: normalizeText(expert.description),
      icon: normalizeText(expert.avatar),
      meta: normalizeText(expert.profession) || normalizeText(expert.categoryName) || (
        expert.type === 'team' ? '专家团' : '专家'
      ),
    };
  }));
  return {
    items,
    total: Number(response.data?.total) || items.length,
    hasMore: Boolean(response.data?.hasMore),
  };
}

function loadResources(kind: ProjectResourceKind, query: string, page: number, options?: ProjectResourceOption[]) {
  if (options) {
    if (page > 1) return Promise.resolve({ items: [], total: 0, hasMore: false });
    const items = uniqueOptions(options).filter((item) => matchesQuery(item, query));
    return Promise.resolve({ items, total: items.length, hasMore: false });
  }
  if (kind === 'connector') return loadAuthorizedConnectors(query, page);
  if (kind === 'skill') return loadMarketSkills(query, page);
  return loadMarketExperts(query, page);
}

function resourceCopy(kind: ProjectResourceKind) {
  if (kind === 'connector') {
    return {
      action: '选择',
      pickerTitle: '选择已授权连接器',
      searchPlaceholder: '搜索已授权连接器',
      emptyLabel: '没有匹配的已授权连接器',
    };
  }
  if (kind === 'skill') {
    return {
      action: '选择',
      pickerTitle: '选择技能',
      searchPlaceholder: '搜索技能市场',
      emptyLabel: '没有匹配的技能',
    };
  }
  return {
    action: '选择',
    pickerTitle: '选择专家',
    searchPlaceholder: '搜索专家市场',
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
  if (kind === 'connector') return <Cable className="h-4 w-4" />;
  if (kind === 'skill') return <Sparkles className="h-4 w-4" />;
  return <Bot className="h-4 w-4" />;
}

export function ProjectResourcePicker({
  kind,
  title,
  description,
  selectedIds,
  onChange,
  options,
}: ProjectResourcePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const [items, setItems] = React.useState<ProjectResourceOption[]>([]);
  const [knownItems, setKnownItems] = React.useState<Record<string, ProjectResourceOption>>({});
  const [page, setPage] = React.useState(1);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState('');
  const requestIdRef = React.useRef(0);
  const copy = resourceCopy(kind);
  const selected = React.useMemo(() => new Set(selectedIds), [selectedIds]);

  React.useEffect(() => {
    if (!options) return;
    setKnownItems(Object.fromEntries(options.map((item) => [item.id, item])));
  }, [options]);

  const rememberItems = React.useCallback((nextItems: ProjectResourceOption[]) => {
    setKnownItems((current) => {
      const next = { ...current };
      for (const item of nextItems) next[item.id] = item;
      return next;
    });
  }, []);

  React.useEffect(() => {
    const requestId = ++requestIdRef.current;
    setLoadingMore(false);
    if (!open) return;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError('');
      void loadResources(kind, query, 1, options)
        .then((result) => {
          if (requestIdRef.current !== requestId) return;
          setItems(result.items);
          rememberItems(result.items);
          setPage(1);
          setTotal(result.total);
          setHasMore(result.hasMore);
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
  }, [kind, open, options, query, rememberItems]);

  const loadMore = async () => {
    if (!hasMore || loadingMore) return;
    const requestId = requestIdRef.current;
    const nextPage = page + 1;
    setLoadingMore(true);
    setError('');
    try {
      const result = await loadResources(kind, query, nextPage, options);
      if (requestIdRef.current !== requestId) return;
      setItems((current) => uniqueOptions([...current, ...result.items]));
      rememberItems(result.items);
      setPage(nextPage);
      setTotal(result.total);
      setHasMore(result.hasMore);
    } catch (err) {
      if (requestIdRef.current === requestId) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      if (requestIdRef.current === requestId) setLoadingMore(false);
    }
  };

  const toggle = (id: string) => {
    onChange(selected.has(id)
      ? selectedIds.filter((entry) => entry !== id)
      : [...selectedIds, id]);
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="space-y-2.5 border-t border-border pt-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground">{title}</div>
          <div className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">{description}</div>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
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
