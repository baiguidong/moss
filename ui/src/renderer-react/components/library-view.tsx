import * as React from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  FilePlus2,
  FileText,
  Filter,
  FlaskConical,
  Folder,
  FolderKanban,
  FolderOpen,
  FolderPlus,
  Loader2,
  Gauge,
  MessageSquarePlus,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Play,
  RefreshCw,
  Save,
  Search,
  Square,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { formatLibraryResourceError } from '@/lib/library-ui';
import {
  buildLibraryResourceTree,
  type LibraryTreeNode,
} from '@/lib/library-tree';
import { cn } from '@/lib/utils';
import type {
  LibraryCollection,
  LibraryEvaluationOverview,
  LibraryExtensionStatus,
  LibraryJob,
  LibraryOverview,
  LibraryResource,
  LibrarySearchResult,
  LibrarySearchDiagnostics,
  LibrarySource,
  Project,
} from '@/types';

type LibraryViewProps = {
  projects: Project[];
  onUseResource: (resource: Pick<LibraryResource, 'id' | 'title' | 'uri'>) => void;
  onUseScope: (scope: { id: string; uri: string; name: string; kind: 'collection' | 'source' }) => void;
  onPrepareDirectoryImport: (payload: { selectionId: string; collectionId: string }) => Promise<void>;
};
const FILE_FILTERS = [
  { id: 'all', label: '全部类型', extensions: [] },
  { id: 'markdown', label: 'Markdown 文档', extensions: ['.md', '.markdown'] },
  { id: 'pdf', label: 'PDF 文档', extensions: ['.pdf'] },
  { id: 'office', label: '办公文档', extensions: ['.docx', '.pptx', '.xlsx'] },
  { id: 'text', label: '文本', extensions: ['.txt', '.log', '.csv'] },
  { id: 'code', label: '代码', extensions: ['.js', '.jsx', '.mjs', '.ts', '.tsx', '.py', '.go', '.rs', '.java', '.c', '.cc', '.cpp'] },
] as const;

const LIBRARY_RESOURCE_PAGE_SIZE = 200;

function formatBytes(value?: number) {
  const size = Number(value) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(value?: number | null) {
  if (!value) return '尚未索引';
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatPercent(value?: number) {
  return `${((Number(value) || 0) * 100).toFixed(0)}%`;
}

function formatSearchLocation(result: Pick<LibrarySearchResult, 'sourceName' | 'heading' | 'page' | 'startLine' | 'endLine' | 'locationKind'>) {
  const parts = [result.sourceName];
  if (result.locationKind === 'slide' && result.page) {
    parts.push(`第 ${result.page} 张幻灯片`);
  } else if (result.locationKind === 'sheet') {
    parts.push(result.heading ? `工作表 ${result.heading}` : `第 ${result.page || 1} 个工作表`);
  } else if (result.page) {
    parts.push(`第 ${result.page} 页`);
  }
  if (result.startLine) {
    const range = result.endLine && result.endLine !== result.startLine
      ? `${result.startLine}-${result.endLine}`
      : String(result.startLine);
    const unit = result.locationKind === 'paragraph' ? '段' : '行';
    parts.push(`第 ${range} ${unit}`);
  }
  if (result.heading && result.locationKind !== 'sheet') parts.push(result.heading);
  return parts.filter(Boolean).join(' · ');
}

function diagnosticReasonLabel(reason?: LibrarySearchDiagnostics['reason']) {
  return ({
    'empty-query': '请输入检索内容',
    'no-indexable-terms': '没有可检索的文字词项',
    'no-scoped-content': '当前范围内没有已完成索引的资料',
    'coverage-filtered': '候选内容与问题的词项覆盖不足',
    'no-lexical-match': '已索引内容中没有词面匹配',
    results: '已返回排序结果',
  } as const)[reason || 'empty-query'];
}

function ResourceStatus({ resource, indexing = false }: { resource: LibraryResource; indexing?: boolean }) {
  if (indexing) {
    return <Badge variant="outline" className="gap-1"><Loader2 className="h-3 w-3 animate-spin" />索引中</Badge>;
  }
  const reason = formatLibraryResourceError(resource);
  if (resource.status === 'ready') return <Badge variant="secondary">已索引</Badge>;
  if (resource.status === 'stale') {
    return reason ? (
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0}><Badge variant="outline">旧版本可用</Badge></span></TooltipTrigger>
        <TooltipContent className="max-w-sm">更新失败：{reason}</TooltipContent>
      </Tooltip>
    ) : <Badge variant="outline">旧版本可用</Badge>;
  }
  if (resource.status === 'failed') {
    return (
      <Tooltip>
        <TooltipTrigger asChild><span tabIndex={0}><Badge variant="destructive">失败</Badge></span></TooltipTrigger>
        <TooltipContent className="max-w-sm">失败原因：{reason || '解析器未返回具体原因。'}</TooltipContent>
      </Tooltip>
    );
  }
  if (resource.status === 'unsupported') return <Badge variant="outline">仅收录</Badge>;
  return <Badge variant="outline">等待索引</Badge>;
}

type ResourceTarget = Pick<LibraryResource, 'id' | 'title'>;
type ResourceContextMenuState = ResourceTarget & { x: number; y: number };

function ResourceContextMenu({
  state,
  onClose,
  onOpen,
  onShowInFolder,
}: {
  state: ResourceContextMenuState;
  onClose: () => void;
  onOpen: (resource: ResourceTarget) => void;
  onShowInFolder: (resource: ResourceTarget) => void;
}) {
  const left = Math.max(8, Math.min(state.x, window.innerWidth - 192));
  const top = Math.max(8, Math.min(state.y, window.innerHeight - 88));
  const resource = { id: state.id, title: state.title };
  return (
    <div
      className="fixed inset-0 z-50"
      onMouseDown={onClose}
      onContextMenu={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div
        role="menu"
        aria-label={`${state.title} 操作`}
        className="absolute w-44 overflow-hidden rounded-md border border-border bg-popover py-1 text-sm text-popover-foreground shadow-lg"
        style={{ left, top }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
          onClick={() => {
            onClose();
            onOpen(resource);
          }}
        >
          <ExternalLink className="h-4 w-4" />
          打开文件
        </button>
        <button
          type="button"
          role="menuitem"
          className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted"
          onClick={() => {
            onClose();
            onShowInFolder(resource);
          }}
        >
          <FolderOpen className="h-4 w-4" />
          在文件夹中显示
        </button>
      </div>
    </div>
  );
}

function LibraryResourceTree({
  resources,
  selectedResourceId,
  indexingResourceIds,
  onSelect,
  onOpen,
  onUse,
  onContextMenu,
}: {
  resources: LibraryResource[];
  selectedResourceId: string | null;
  indexingResourceIds: Set<string>;
  onSelect: (resourceId: string) => void;
  onOpen: (resource: LibraryResource) => void;
  onUse: (resource: LibraryResource) => void;
  onContextMenu: (event: React.MouseEvent, resource: LibraryResource) => void;
}) {
  const tree = React.useMemo(() => buildLibraryResourceTree(resources), [resources]);
  const [expanded, setExpanded] = React.useState<Set<string>>(() => new Set());

  const renderNode = (node: LibraryTreeNode, depth: number): React.ReactNode => {
    const inset = 12 + depth * 18;
    if (node.kind === 'directory') {
      const open = expanded.has(node.id);
      return (
        <div key={node.id} role="treeitem" aria-expanded={open}>
          <button
            type="button"
            className="flex h-9 w-full min-w-0 items-center gap-2 border-b border-border/50 pr-3 text-left hover:bg-muted/30 focus-visible:bg-muted/40 focus-visible:outline-none"
            style={{ paddingLeft: inset }}
            onClick={() => setExpanded((current) => {
              const next = new Set(current);
              if (open) next.delete(node.id);
              else next.add(node.id);
              return next;
            })}
          >
            {open
              ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {open
              ? <FolderOpen className="h-4 w-4 shrink-0 text-amber-600" />
              : <Folder className="h-4 w-4 shrink-0 text-amber-600" />}
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground" title={node.path}>{node.name}</span>
            <span className={cn('shrink-0 text-[11px]', node.errorCount ? 'text-destructive' : 'text-muted-foreground')}>
              {node.fileCount} 个文件{node.errorCount ? ` · ${node.errorCount} 个失败` : ''}
            </span>
          </button>
          {open ? <div role="group">{node.children.map((child) => renderNode(child, depth + 1))}</div> : null}
        </div>
      );
    }

    const resource = node.resource;
    const originalPath = typeof resource.metadata?.originalRelativePath === 'string'
      ? resource.metadata.originalRelativePath
      : node.path;
    const indexing = indexingResourceIds.has(resource.id);
    return (
      <div
        key={node.id}
        role="treeitem"
        aria-selected={selectedResourceId === resource.id}
        tabIndex={0}
        className={cn(
          'group flex min-h-12 min-w-0 items-center gap-2 border-b border-border/50 py-2 pr-3 outline-none hover:bg-muted/25 focus-visible:bg-muted/40',
          selectedResourceId === resource.id && 'bg-muted/50',
        )}
        style={{ paddingLeft: inset + 20 }}
        onClick={() => onSelect(resource.id)}
        onDoubleClick={() => onOpen(resource)}
        onContextMenu={(event) => onContextMenu(event, resource)}
      >
        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm text-foreground" title={originalPath}>{node.name}</div>
          <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
            {formatBytes(resource.size)} · {resource.indexedAt ? `索引于 ${formatTime(resource.indexedAt)}` : '尚未完成索引'}
          </div>
          {resource.error && ['failed', 'stale'].includes(resource.status) ? (
            <div className="mt-0.5 truncate text-xs text-destructive" title={formatLibraryResourceError(resource)}>
              {resource.status === 'stale' ? '更新失败' : '失败原因'}：{formatLibraryResourceError(resource)}
            </div>
          ) : null}
        </div>
        <ResourceStatus resource={resource} indexing={indexing} />
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onOpen(resource);
              }}
              aria-label={`打开文件 ${node.name}`}
            >
              <ExternalLink className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>在本地打开</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
              onClick={(event) => {
                event.stopPropagation();
                onUse(resource);
              }}
              aria-label={`在对话中使用 ${node.name}`}
            >
              <MessageSquarePlus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>加入对话</TooltipContent>
        </Tooltip>
      </div>
    );
  };

  return <div role="tree" aria-label="资料目录">{tree.children.map((node) => renderNode(node, 0))}</div>;
}

function extensionStatusLabel(status?: LibraryExtensionStatus['status']) {
  if (status === 'ready') return '已安装';
  if (status === 'partial') return '部分安装';
  if (status === 'installing') return '安装中';
  if (status === 'error') return '安装失败';
  if (status === 'unavailable') return 'Python 不可用';
  return '未安装';
}

export function LibraryView({ projects, onUseResource, onUseScope, onPrepareDirectoryImport }: LibraryViewProps) {
  const [overview, setOverview] = React.useState<LibraryOverview | null>(null);
  const [collections, setCollections] = React.useState<LibraryCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = React.useState<string | null>(null);
  const [sources, setSources] = React.useState<LibrarySource[]>([]);
  const [resources, setResources] = React.useState<LibraryResource[]>([]);
  const [hasMoreResources, setHasMoreResources] = React.useState(false);
  const [searchResults, setSearchResults] = React.useState<LibrarySearchResult[]>([]);
  const [selectedResourceId, setSelectedResourceId] = React.useState<string | null>(null);
  const [resourceContextMenu, setResourceContextMenu] = React.useState<ResourceContextMenuState | null>(null);
  const [jobs, setJobs] = React.useState<LibraryJob[]>([]);
  const [query, setQuery] = React.useState('');
  const [fileFilter, setFileFilter] = React.useState<(typeof FILE_FILTERS)[number]['id']>('all');
  const [loading, setLoading] = React.useState(true);
  const [searching, setSearching] = React.useState(false);
  const [busyAction, setBusyAction] = React.useState('');
  const [error, setError] = React.useState('');
  const [collectionEditor, setCollectionEditor] = React.useState<{
    mode: 'create' | 'edit';
    collection?: LibraryCollection;
  } | null>(null);
  const [collectionName, setCollectionName] = React.useState('');
  const [collectionDescription, setCollectionDescription] = React.useState('');
  const [collectionFormError, setCollectionFormError] = React.useState('');
  const [extensionsOpen, setExtensionsOpen] = React.useState(false);
  const [extensionStatus, setExtensionStatus] = React.useState<LibraryExtensionStatus | null>(null);
  const [selectedExtensionIds, setSelectedExtensionIds] = React.useState<string[]>([]);
  const [extensionGuideVisible, setExtensionGuideVisible] = React.useState(false);
  const [extensionLoading, setExtensionLoading] = React.useState(false);
  const [extensionInstalling, setExtensionInstalling] = React.useState(false);
  const [refreshSignal, setRefreshSignal] = React.useState(0);
  const [diagnosticsOpen, setDiagnosticsOpen] = React.useState(false);
  const [diagnosticsTab, setDiagnosticsTab] = React.useState<'search' | 'evaluation'>('search');
  const [diagnosticQuery, setDiagnosticQuery] = React.useState('');
  const [diagnosticResult, setDiagnosticResult] = React.useState<{
    items: LibrarySearchResult[];
    diagnostics: LibrarySearchDiagnostics;
  } | null>(null);
  const [evaluationOverview, setEvaluationOverview] = React.useState<LibraryEvaluationOverview | null>(null);
  const [diagnosticsLoading, setDiagnosticsLoading] = React.useState(false);
  const [evaluationRunning, setEvaluationRunning] = React.useState(false);
  const [editingEvaluationCaseId, setEditingEvaluationCaseId] = React.useState<string | null>(null);
  const [evaluationQueryDraft, setEvaluationQueryDraft] = React.useState('');
  const collectionNameInputRef = React.useRef<HTMLInputElement>(null);
  const selectedCollectionIdRef = React.useRef<string | null>(null);
  const fileFilterRef = React.useRef<(typeof FILE_FILTERS)[number]['id']>('all');
  selectedCollectionIdRef.current = selectedCollectionId;
  fileFilterRef.current = fileFilter;

  const selectedExtensions = (filterId = fileFilterRef.current) => (
    FILE_FILTERS.find((entry) => entry.id === filterId)?.extensions || []
  );

  const load = React.useCallback(async (preferredCollectionId?: string | null) => {
    setLoading(true);
    try {
      const [nextOverview, nextCollections] = await Promise.all([
        window.agentDesktop.library.getOverview(),
        window.agentDesktop.library.listCollections(),
      ]);
      setOverview(nextOverview);
      setCollections(nextCollections);
      const requestedId = preferredCollectionId === undefined
        ? selectedCollectionIdRef.current
        : preferredCollectionId;
      const collectionId = nextCollections.some((entry) => entry.id === requestedId)
        ? requestedId
        : nextOverview.defaultCollectionId || nextCollections[0]?.id || null;
      setSelectedCollectionId(collectionId);
      if (!collectionId) {
        setSources([]);
        setResources([]);
        setHasMoreResources(false);
        setJobs([]);
        return;
      }
      const [nextSources, nextResources, nextJobs] = await Promise.all([
        window.agentDesktop.library.listSources({ collectionId }),
        window.agentDesktop.library.listResources({
          collectionId,
          extensions: [...selectedExtensions()],
          limit: LIBRARY_RESOURCE_PAGE_SIZE,
        }),
        window.agentDesktop.library.listJobs({ limit: 50 }),
      ]);
      setSources(nextSources);
      setResources(nextResources);
      setHasMoreResources(nextResources.length === LIBRARY_RESOURCE_PAGE_SIZE);
      setJobs(nextJobs);
      setError('');
    } catch (loadError) {
      setError(cleanIpcErrorMessage(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load, refreshSignal]);

  React.useEffect(() => {
    if (!collectionEditor) return;
    setCollectionName(collectionEditor.collection?.name || '');
    setCollectionDescription(collectionEditor.collection?.description || '');
    setCollectionFormError('');
    window.setTimeout(() => collectionNameInputRef.current?.focus(), 0);
  }, [collectionEditor]);

  React.useEffect(() => {
    let timer: number | null = null;
    const unsubscribe = window.agentDesktop.library.onChanged(() => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        setRefreshSignal((value) => value + 1);
      }, 250);
    });
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  React.useEffect(() => {
    if (!jobs.some((job) => ['queued', 'running'].includes(job.status))) return;
    const timer = window.setInterval(() => setRefreshSignal((value) => value + 1), 1_500);
    return () => window.clearInterval(timer);
  }, [jobs]);

  React.useEffect(() => {
    if (!selectedCollectionId) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      setSearching(Boolean(query.trim()));
      try {
        if (query.trim()) {
          const results = await window.agentDesktop.library.search({
            collectionId: selectedCollectionId,
            extensions: [...selectedExtensions(fileFilter)],
            query: query.trim(),
            mode: 'auto',
          });
          if (!cancelled) setSearchResults(results);
        } else {
          const nextResources = await window.agentDesktop.library.listResources({
            collectionId: selectedCollectionId,
            extensions: [...selectedExtensions(fileFilter)],
            limit: LIBRARY_RESOURCE_PAGE_SIZE,
          });
          if (!cancelled) {
            setResources(nextResources);
            setHasMoreResources(nextResources.length === LIBRARY_RESOURCE_PAGE_SIZE);
            setSearchResults([]);
          }
        }
      } catch (searchError) {
        if (!cancelled) setError(cleanIpcErrorMessage(searchError));
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [fileFilter, query, selectedCollectionId, refreshSignal]);

  const selectCollection = async (collectionId: string) => {
    setSelectedCollectionId(collectionId);
    setQuery('');
    setSearchResults([]);
    setLoading(true);
    try {
      const [nextSources, nextResources] = await Promise.all([
        window.agentDesktop.library.listSources({ collectionId }),
        window.agentDesktop.library.listResources({
          collectionId,
          extensions: [...selectedExtensions()],
          limit: LIBRARY_RESOURCE_PAGE_SIZE,
        }),
      ]);
      setSources(nextSources);
      setResources(nextResources);
      setHasMoreResources(nextResources.length === LIBRARY_RESOURCE_PAGE_SIZE);
      setError('');
    } catch (selectError) {
      setError(cleanIpcErrorMessage(selectError));
    } finally {
      setLoading(false);
    }
  };

  const loadMoreResources = async () => {
    if (!selectedCollectionId || busyAction) return;
    setBusyAction('load-more');
    try {
      const next = await window.agentDesktop.library.listResources({
        collectionId: selectedCollectionId,
        extensions: [...selectedExtensions(fileFilter)],
        limit: LIBRARY_RESOURCE_PAGE_SIZE,
        offset: resources.length,
      });
      setResources((current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]));
        for (const entry of next) byId.set(entry.id, entry);
        return [...byId.values()];
      });
      setHasMoreResources(next.length === LIBRARY_RESOURCE_PAGE_SIZE);
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const saveCollection = async () => {
    if (!collectionEditor) return;
    const name = collectionName.trim();
    if (!name) {
      setCollectionFormError('请输入资料集名称');
      collectionNameInputRef.current?.focus();
      return;
    }
    const action = collectionEditor.mode === 'create'
      ? 'create-collection'
      : `edit:${collectionEditor.collection?.id}`;
    setBusyAction(action);
    setCollectionFormError('');
    try {
      const collection = collectionEditor.mode === 'create'
        ? await window.agentDesktop.library.createCollection({
            name,
            description: collectionDescription.trim(),
          })
        : await window.agentDesktop.library.updateCollection({
            id: collectionEditor.collection!.id,
            name,
            description: collectionDescription.trim(),
          });
      selectedCollectionIdRef.current = collection.id;
      setSelectedCollectionId(collection.id);
      setCollectionEditor(null);
      await load(collection.id);
    } catch (actionError) {
      setCollectionFormError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const deleteCollection = async (collection: LibraryCollection) => {
    if (!window.confirm(`删除“${collection.name}”？仅属于该资料集的资料和索引也会移除。`)) return;
    setBusyAction(`delete:${collection.id}`);
    try {
      await window.agentDesktop.library.deleteCollection({ id: collection.id });
      if (selectedCollectionId === collection.id) setSelectedCollectionId(null);
      await load();
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const addLocalFiles = async (): Promise<LibrarySource[]> => {
    if (!selectedCollectionId) return [];
    setBusyAction('add:files');
    try {
      const picked = await window.agentDesktop.library.pickSources({
        collectionId: selectedCollectionId,
        kind: 'files',
      });
      if (picked.length === 0) return [];
      await load();
      return picked;
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
      return [];
    } finally {
      setBusyAction('');
    }
  };

  const selectDirectory = async () => {
    if (!selectedCollectionId || activeCollection?.scope.kind !== 'personal') return;
    setBusyAction('select:directory');
    try {
      const selection = await window.agentDesktop.library.selectDirectory();
      if (!selection) return;
      await onPrepareDirectoryImport({
        selectionId: selection.selectionId,
        collectionId: selectedCollectionId,
      });
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const openResourceFile = async (resource: ResourceTarget) => {
    try {
      await window.agentDesktop.library.openResource({ resourceId: resource.id });
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    }
  };

  const showResourceInFolder = async (resource: ResourceTarget) => {
    try {
      await window.agentDesktop.library.showResourceInFolder({ resourceId: resource.id });
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    }
  };

  const addProject = async (project: Project) => {
    if (!selectedCollectionId) return;
    setBusyAction(`project:${project.id}`);
    try {
      await window.agentDesktop.library.addProjectSource({
        collectionId: selectedCollectionId,
        projectId: project.id,
      });
      await load();
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const cancelIndexing = async (job: LibraryJob) => {
    setBusyAction(`cancel:${job.id}`);
    try {
      await window.agentDesktop.library.cancelJob({ jobId: job.id });
      await load();
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const cancelCollectionIndexing = async (activeJobs: LibraryJob[]) => {
    if (activeJobs.length === 0) return;
    setBusyAction('cancel:collection');
    try {
      await Promise.all(activeJobs.map((job) => (
        window.agentDesktop.library.cancelJob({ jobId: job.id })
      )));
      await load();
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const migrateLegacy = async () => {
    const count = overview?.migration.sourceCount || 0;
    const roots = (overview?.migration.knowledgeBases || []).flatMap((knowledgeBase) => (
      knowledgeBase.paths.map((source) => `${knowledgeBase.name} / ${source.path}${source.exists ? '' : '（已丢失，将跳过）'}`)
    ));
    const preview = roots.slice(0, 10).join('\n');
    const remaining = Math.max(0, roots.length - 10);
    if (!window.confirm([
      `迁移 ${overview?.migration.knowledgeBases.length || 0} 个旧知识库和 ${count} 个来源？`,
      preview,
      remaining ? `另有 ${remaining} 个来源` : '',
      '将重新构建索引；旧数据库保持不变，并先备份当前资料库注册信息。',
    ].filter(Boolean).join('\n\n'))) return;
    setBusyAction('migrate');
    try {
      await window.agentDesktop.library.migrateLegacy();
      await load();
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const dismissMigration = async () => {
    await window.agentDesktop.library.dismissLegacyMigration();
    await load();
  };

  const repairIndex = async () => {
    if (!window.confirm('删除本地派生索引并从所有已注册来源重建？原始文件和项目资产不会被修改。')) return;
    setBusyAction('repair');
    try {
      await window.agentDesktop.library.repairIndex();
      await load();
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const exportData = async (includeIndex: boolean) => {
    setBusyAction(includeIndex ? 'export-full' : 'export-registrations');
    try {
      await window.agentDesktop.library.exportData({ includeIndex });
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setBusyAction('');
    }
  };

  const loadExtensionStatus = React.useCallback(async (resetSelection = true) => {
    setExtensionLoading(true);
    try {
      const next = await window.agentDesktop.library.getExtensionStatus();
      setExtensionStatus(next);
      setExtensionGuideVisible(next.status === 'not-installed' && next.guideAcknowledged !== true);
      if (resetSelection) setSelectedExtensionIds(next.packages.map((entry) => entry.id));
    } catch (statusError) {
      setError(cleanIpcErrorMessage(statusError));
    } finally {
      setExtensionLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadExtensionStatus();
    return window.agentDesktop.library.onChanged((payload) => {
      if (payload?.reason === 'extensions-changed') void loadExtensionStatus(false);
    });
  }, [loadExtensionStatus]);

  const acknowledgeExtensionGuide = async () => {
    setExtensionGuideVisible(false);
    setExtensionStatus((current) => current ? { ...current, guideAcknowledged: true } : current);
    try {
      await window.agentDesktop.library.acknowledgeExtensionGuide();
    } catch (guideError) {
      setError(cleanIpcErrorMessage(guideError));
    }
  };

  const openExtensionPicker = () => {
    setExtensionsOpen(true);
    if (extensionGuideVisible) {
      void acknowledgeExtensionGuide().then(() => loadExtensionStatus());
    } else {
      void loadExtensionStatus();
    }
  };

  const installExtensions = () => {
    if (selectedExtensionIds.length === 0) return;
    setExtensionInstalling(true);
    setExtensionStatus((current) => current ? { ...current, status: 'installing', error: '' } : current);
    setExtensionGuideVisible(false);
    setExtensionsOpen(false);
    void window.agentDesktop.library.installExtensions({
        packageIds: selectedExtensionIds,
      })
      .then((next) => setExtensionStatus(next))
      .catch((installError) => {
        const message = cleanIpcErrorMessage(installError);
        setExtensionStatus((current) => current ? { ...current, status: 'error', error: message } : null);
        if (!extensionStatus) setError(message);
      })
      .finally(() => setExtensionInstalling(false));
  };

  const loadEvaluationOverview = React.useCallback(async () => {
    const next = await window.agentDesktop.library.getEvaluationOverview();
    setEvaluationOverview(next);
    return next;
  }, []);

  const openDiagnostics = () => {
    const currentQuery = query.trim();
    setDiagnosticQuery(currentQuery);
    setDiagnosticsTab(currentQuery ? 'search' : 'evaluation');
    setDiagnosticsOpen(true);
    setDiagnosticsLoading(true);
    void Promise.all([
      loadEvaluationOverview(),
      window.agentDesktop.library.getOverview().then(setOverview),
    ]).catch((actionError) => setError(cleanIpcErrorMessage(actionError)))
      .finally(() => setDiagnosticsLoading(false));
  };

  const runDiagnosticSearch = async () => {
    const value = diagnosticQuery.trim();
    if (!value) return;
    setDiagnosticsLoading(true);
    try {
      const result = await window.agentDesktop.library.diagnoseSearch({
        query: value,
        collectionId: selectedCollectionId || undefined,
        extensions: [...selectedExtensions(fileFilter)],
        mode: 'auto',
        limit: 30,
      });
      setDiagnosticResult(result);
      setOverview(await window.agentDesktop.library.getOverview());
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const saveEvaluationSample = async (result: LibrarySearchResult | null, value = diagnosticQuery || query) => {
    const sampleQuery = value.trim();
    if (!sampleQuery) return;
    setDiagnosticsLoading(true);
    try {
      await window.agentDesktop.library.saveEvaluationCase({
        name: result ? `${sampleQuery} -> ${result.title}` : `${sampleQuery} -> 无结果`,
        query: sampleQuery,
        expectedResourceId: result?.resourceId || null,
        expectedHeading: result?.heading || null,
        collectionId: selectedCollectionId,
      });
      await loadEvaluationOverview();
      setDiagnosticQuery(sampleQuery);
      setDiagnosticsTab('evaluation');
      setDiagnosticsOpen(true);
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const deleteEvaluationSample = async (id: string) => {
    setDiagnosticsLoading(true);
    try {
      await window.agentDesktop.library.deleteEvaluationCase({ id });
      await loadEvaluationOverview();
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const saveEditedEvaluationSample = async () => {
    const entry = evaluationOverview?.cases.find((item) => item.id === editingEvaluationCaseId);
    const nextQuery = evaluationQueryDraft.trim();
    if (!entry || !nextQuery) return;
    setDiagnosticsLoading(true);
    try {
      await window.agentDesktop.library.saveEvaluationCase({
        id: entry.id,
        name: `${nextQuery} -> ${entry.expectedResourceTitle || '无结果'}`,
        query: nextQuery,
        expectedResourceId: entry.expectedResourceId,
        expectedHeading: entry.expectedHeading,
        collectionId: entry.collectionId,
        sourceId: entry.sourceId,
        scopeKind: entry.scopeKind,
      });
      await loadEvaluationOverview();
      setEditingEvaluationCaseId(null);
      setEvaluationQueryDraft('');
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setDiagnosticsLoading(false);
    }
  };

  const runEvaluation = async () => {
    setEvaluationRunning(true);
    try {
      const latestRun = await window.agentDesktop.library.runEvaluation({});
      const current = await loadEvaluationOverview();
      setEvaluationOverview({ ...current, latestRun });
      setOverview(await window.agentDesktop.library.getOverview());
    } catch (actionError) {
      setError(cleanIpcErrorMessage(actionError));
    } finally {
      setEvaluationRunning(false);
    }
  };

  const activeCollection = collections.find((entry) => entry.id === selectedCollectionId) || null;
  const selectedSourceIds = new Set(sources.map((source) => source.id));
  const activeCollectionJobs = jobs.filter((job) => (
    job.sourceId && selectedSourceIds.has(job.sourceId) && ['queued', 'running'].includes(job.status)
  ));
  const indexingResourceIds = new Set(activeCollectionJobs.flatMap((job) => (
    job.progress.currentResourceId ? [job.progress.currentResourceId] : []
  )));
  const indexingProgress = activeCollectionJobs.reduce((summary, job) => ({
    discovered: summary.discovered + (job.progress.discovered || 0),
    indexed: summary.indexed + (job.progress.indexed || 0),
  }), { discovered: 0, indexed: 0 });
  const activeRepairJob = jobs.find((job) => (
    !job.sourceId && job.kind === 'repair' && ['queued', 'running'].includes(job.status)
  ));

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      {resourceContextMenu ? (
        <ResourceContextMenu
          state={resourceContextMenu}
          onClose={() => setResourceContextMenu(null)}
          onOpen={(resource) => void openResourceFile(resource)}
          onShowInFolder={(resource) => void showResourceInFolder(resource)}
        />
      ) : null}
      <header className="shrink-0 border-b border-border px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/40">
              <BookOpen className="h-4 w-4 text-foreground" />
            </div>
            <div className="min-w-0">
              <h1 className="text-base font-semibold text-foreground">资料库</h1>
              <p className="truncate text-xs text-muted-foreground">
                {overview
                  ? `${overview.stats.resources} 份资料 · ${overview.stats.chunks} 个检索片段 · ${overview.engine.status === 'ready' ? '解析器可用' : overview.engine.status === 'installing' ? '解析器准备中' : '解析器不可用'}`
                  : '本地资料与项目资料'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void addLocalFiles()} disabled={!selectedCollectionId || Boolean(busyAction)}>
              {busyAction === 'add:files' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus2 className="h-4 w-4" />}
              文件
            </Button>
            <Button
              variant="outline"
              size="sm"
              aria-label="添加资料目录"
              title={activeCollection?.scope.kind === 'project' ? '智能目录整理仅支持个人资料集' : undefined}
              onClick={() => void selectDirectory()}
              disabled={!selectedCollectionId || activeCollection?.scope.kind !== 'personal' || Boolean(busyAction)}
            >
              {busyAction === 'select:directory' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
              目录
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" disabled={!selectedCollectionId || projects.length === 0 || Boolean(busyAction)}>
                  <FolderKanban className="h-4 w-4" />
                  项目
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {projects.map((project) => (
                  <DropdownMenuItem key={project.id} onClick={() => void addProject(project)}>
                    <FolderKanban className="h-4 w-4" />
                    <span className="truncate">{project.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="outline"
              size="sm"
              onClick={openExtensionPicker}
            >
              {extensionStatus?.status === 'installing'
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <PackagePlus className="h-4 w-4" />}
              {extensionStatus?.status === 'installing' ? '扩展安装中' : '扩展'}
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon-sm" disabled={Boolean(busyAction)} aria-label="资料库数据操作">
                  {busyAction === 'repair' ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={openDiagnostics}>
                  <Gauge className="h-4 w-4" />检索评测与诊断
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void exportData(false)}>
                  <Download className="h-4 w-4" />导出资料库配置
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void exportData(true)}>
                  <Download className="h-4 w-4" />导出完整索引
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => void repairIndex()}>
                  <Wrench className="h-4 w-4" />修复并重建索引
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {extensionGuideVisible ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-5 py-3">
          <div className="flex min-w-0 items-start gap-3">
            <PackagePlus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div className="min-w-0">
              <div className="text-sm font-medium text-foreground">安装可选的文档解析扩展</div>
              <p className="mt-0.5 text-xs text-muted-foreground">增强 Word、PDF、演示文稿、表格和中文内容处理能力。</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button variant="ghost" size="sm" onClick={() => void acknowledgeExtensionGuide()}>暂不安装</Button>
            <Button size="sm" onClick={openExtensionPicker}>选择扩展</Button>
          </div>
        </div>
      ) : extensionStatus?.status === 'installing' ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-5 py-2.5 text-sm text-foreground">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            资料库扩展正在后台安装，你可以继续使用资料库。
          </span>
          <Button variant="ghost" size="sm" onClick={openExtensionPicker}>查看</Button>
        </div>
      ) : extensionStatus?.status === 'error' ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-destructive/25 bg-destructive/5 px-5 py-2.5 text-sm text-destructive">
          <span className="inline-flex min-w-0 items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />资料库扩展安装失败
          </span>
          <Button variant="ghost" size="sm" onClick={openExtensionPicker}>查看详情</Button>
        </div>
      ) : null}

      {activeRepairJob ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-5 py-2.5 text-sm text-foreground">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            正在重建资料库索引
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busyAction === `cancel:${activeRepairJob.id}`}
            onClick={() => void cancelIndexing(activeRepairJob)}
          >
            {busyAction === `cancel:${activeRepairJob.id}`
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Square className="h-3.5 w-3.5 fill-current" />}
            停止
          </Button>
        </div>
      ) : null}

      {!activeRepairJob && activeCollectionJobs.length > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-primary/20 bg-primary/5 px-5 py-2.5 text-sm text-foreground">
          <span className="inline-flex min-w-0 items-center gap-2">
            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
            <span className="truncate">
              正在索引“{activeCollection?.name || '当前资料集'}”
              {indexingProgress.discovered > 0 ? ` · ${indexingProgress.indexed}/${indexingProgress.discovered}` : ''}
            </span>
          </span>
          <Button
            variant="outline"
            size="sm"
            className="border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={busyAction === 'cancel:collection'}
            onClick={() => void cancelCollectionIndexing(activeCollectionJobs)}
          >
            {busyAction === 'cancel:collection'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Square className="h-3.5 w-3.5 fill-current" />}
            停止
          </Button>
        </div>
      ) : null}

      {overview?.migration.available ? (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-amber-500/30 bg-amber-500/8 px-5 py-3">
          <div className="text-sm text-foreground">
            检测到旧版资料库：{overview.migration.knowledgeBases.length} 个知识库，{overview.migration.sourceCount || 0} 个来源。
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={() => void dismissMigration()}>忽略</Button>
            <Button size="sm" onClick={() => void migrateLegacy()} disabled={busyAction === 'migrate'}>
              {busyAction === 'migrate' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              迁移并重建
            </Button>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="flex shrink-0 items-center gap-2 border-b border-destructive/25 bg-destructive/5 px-5 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{error}</span>
          <Button variant="ghost" size="sm" onClick={() => setError('')}>关闭</Button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[240px_minmax(0,1fr)]">
        <aside className="min-h-0 border-b border-border lg:border-b-0 lg:border-r">
          <div className="flex h-11 items-center justify-between border-b border-border px-3">
            <span className="text-xs font-medium text-muted-foreground">资料集</span>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon-sm" onClick={() => setCollectionEditor({ mode: 'create' })} disabled={Boolean(busyAction)} aria-label="新建资料集">
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>新建资料集</TooltipContent>
            </Tooltip>
          </div>
          <ScrollArea className="h-[180px] lg:h-[calc(100%-2.75rem)]">
            <div className="space-y-0.5 p-2">
              {collections.map((collection) => (
                <div
                  key={collection.id}
                  className={cn(
                    'group flex items-center gap-1 rounded-md px-1 py-1',
                    selectedCollectionId === collection.id ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
                  )}
                >
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 px-1.5 py-1 text-left" onClick={() => void selectCollection(collection.id)}>
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 flex-1 truncate text-sm" title={collection.name}>{collection.name}</span>
                    <span className="shrink-0 text-[11px] text-muted-foreground">{collection.resourceCount}</span>
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon-sm" className="h-7 w-7 opacity-0 group-hover:opacity-100" aria-label={`${collection.name} 操作`}>
                        <MoreHorizontal className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuItem onClick={() => onUseScope({
                        id: collection.id, uri: collection.uri, name: collection.name, kind: 'collection',
                      })}>
                        <MessageSquarePlus className="h-4 w-4" />加入对话检索范围
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setCollectionEditor({ mode: 'edit', collection })}>编辑资料集</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem className="text-destructive" onClick={() => void deleteCollection(collection)}>
                        <Trash2 className="h-4 w-4" />删除
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          </ScrollArea>
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2 sm:h-11 sm:flex-nowrap sm:gap-3 sm:py-0">
            <div className="relative order-first min-w-0 basis-full sm:basis-auto sm:flex-1">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={activeCollection ? `搜索 ${activeCollection.name}` : '搜索资料库'}
                className="h-8 pl-8"
              />
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 shrink-0">
                  <Filter className="h-3.5 w-3.5" />
                  {FILE_FILTERS.find((entry) => entry.id === fileFilter)?.label || '全部类型'}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {FILE_FILTERS.map((entry) => (
                  <DropdownMenuItem key={entry.id} onClick={() => setFileFilter(entry.id)}>
                    {entry.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            {searching ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
          </div>
          <ScrollArea constrainContentWidth className="min-h-0 min-w-0 flex-1">
            {loading ? (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取资料库
              </div>
            ) : query.trim() ? (
              <div className="min-w-0 divide-y divide-border" role="listbox" aria-label="资料库搜索结果">
                {searchResults.map((result) => (
                  <div
                    key={`${result.chunkId}:${result.resourceId}`}
                    role="option"
                    aria-selected={selectedResourceId === result.resourceId}
                    tabIndex={0}
                    className={cn(
                      'min-w-0 overflow-hidden px-4 py-3 outline-none hover:bg-muted/25 focus-visible:bg-muted/40',
                      selectedResourceId === result.resourceId && 'bg-muted/50',
                    )}
                    onClick={() => setSelectedResourceId(result.resourceId)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setSelectedResourceId(result.resourceId);
                      setResourceContextMenu({
                        id: result.resourceId,
                        title: result.title,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="block max-w-full truncate text-left text-sm font-medium text-foreground" title={result.title}>
                          {result.title}
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground" title={formatSearchLocation(result)}>
                          {formatSearchLocation(result)}
                        </div>
                        <div className="mt-1 flex min-w-0 flex-wrap gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                          {result.rank.matchedFields.filter((field) => field !== 'body').map((field) => (
                            <span key={field}>{({ title: '标题命中', path: '路径命中', heading: '章节命中', body: '正文命中' } as const)[field]}</span>
                          ))}
                          {result.rank.exactPhrase ? <span>完整短语</span> : null}
                          {result.rank.fallbackMode === 'any' ? <span>宽松补召回</span> : null}
                        </div>
                        <p className="mt-2 line-clamp-3 text-sm leading-6 text-muted-foreground">{result.snippet}</p>
                      </div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="shrink-0"
                            onClick={(event) => {
                              event.stopPropagation();
                              void saveEvaluationSample(result, query);
                            }}
                            aria-label={`将 ${result.title} 设为评测目标`}
                          >
                            <FlaskConical className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>设为评测目标</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-sm" className="shrink-0" onClick={() => void openResourceFile({ id: result.resourceId, title: result.title })} aria-label={`打开文件 ${result.title}`}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>在本地打开</TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-sm" onClick={() => onUseResource({ id: result.resourceId, title: result.title, uri: result.uri })} aria-label={`在对话中使用 ${result.title}`}>
                            <MessageSquarePlus className="h-4 w-4" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>加入对话</TooltipContent>
                      </Tooltip>
                    </div>
                  </div>
                ))}
                {searchResults.length === 0 ? <div className="px-6 py-16 text-center text-sm text-muted-foreground">没有匹配的检索片段</div> : null}
              </div>
            ) : (
              <div className="min-w-0">
                {resources.length > 0 ? (
                  <LibraryResourceTree
                    key={selectedCollectionId}
                    resources={resources}
                    selectedResourceId={selectedResourceId}
                    indexingResourceIds={indexingResourceIds}
                    onSelect={setSelectedResourceId}
                    onOpen={(resource) => void openResourceFile(resource)}
                    onUse={onUseResource}
                    onContextMenu={(event, resource) => {
                      event.preventDefault();
                      setSelectedResourceId(resource.id);
                      setResourceContextMenu({
                        id: resource.id,
                        title: resource.title,
                        x: event.clientX,
                        y: event.clientY,
                      });
                    }}
                  />
                ) : null}
                {resources.length > 0 && hasMoreResources ? (
                  <div className="flex justify-center border-t border-border px-4 py-3">
                    <Button variant="ghost" size="sm" disabled={Boolean(busyAction)} onClick={() => void loadMoreResources()}>
                      {busyAction === 'load-more' ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                      加载更多
                    </Button>
                  </div>
                ) : null}
                {resources.length === 0 ? (
                  <div className="px-6 py-16 text-center">
                    <BookOpen className="mx-auto h-6 w-6 text-muted-foreground" />
                    <div className="mt-3 text-sm font-medium text-foreground">当前资料集还没有资料</div>
                    <div className="mt-1 text-xs text-muted-foreground">添加文件、目录或项目资产后会自动建立索引</div>
                  </div>
                ) : null}
              </div>
            )}
          </ScrollArea>
        </main>
      </div>

      {diagnosticsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setDiagnosticsOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="检索评测与诊断"
            className="flex max-h-[min(820px,calc(100vh-32px))] w-full max-w-4xl flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
          >
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Gauge className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-foreground">检索评测与诊断</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {activeCollection?.name || '资料库'}
                </p>
              </div>
              <Button variant="ghost" size="icon-sm" onClick={() => setDiagnosticsOpen(false)} aria-label="关闭">
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="flex shrink-0 items-center gap-1 border-b border-border px-5 py-2">
              {([['search', '单次诊断'], ['evaluation', '评测样例']] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={cn(
                    'h-8 rounded-md px-3 text-sm transition-colors',
                    diagnosticsTab === value
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                  onClick={() => setDiagnosticsTab(value)}
                >
                  {label}
                </button>
              ))}
            </div>

            <ScrollArea constrainContentWidth className="min-h-0 flex-1">
              {diagnosticsTab === 'search' ? (
                <div className="space-y-5 p-5">
                  <form
                    className="flex min-w-0 gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void runDiagnosticSearch();
                    }}
                  >
                    <div className="relative min-w-0 flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        value={diagnosticQuery}
                        onChange={(event) => setDiagnosticQuery(event.target.value)}
                        placeholder="输入需要分析的检索内容"
                        className="pl-8"
                        autoFocus
                      />
                    </div>
                    <Button type="submit" disabled={diagnosticsLoading || !diagnosticQuery.trim()}>
                      {diagnosticsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                      运行
                    </Button>
                  </form>

                  {diagnosticResult ? (
                    <>
                      <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-md border border-border sm:grid-cols-5 sm:divide-y-0">
                        {[
                          ['范围资源', diagnosticResult.diagnostics.scopedResourceCount],
                          ['严格候选', diagnosticResult.diagnostics.candidateCounts.all || 0],
                          ['宽松候选', diagnosticResult.diagnostics.candidateCounts.any || 0],
                          ['覆盖淘汰', diagnosticResult.diagnostics.coverageRejectedCount],
                          ['耗时', `${diagnosticResult.diagnostics.durationMs.toFixed(1)} ms`],
                        ].map(([label, value]) => (
                          <div key={label} className={cn('min-w-0 px-3 py-2.5', label === '耗时' && 'col-span-2 sm:col-span-1')}>
                            <div className="text-[11px] text-muted-foreground">{label}</div>
                            <div className="mt-0.5 truncate text-sm font-medium text-foreground">{value}</div>
                          </div>
                        ))}
                      </div>

                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <Badge variant={diagnosticResult.items.length ? 'secondary' : 'outline'}>
                          {diagnosticReasonLabel(diagnosticResult.diagnostics.reason)}
                        </Badge>
                        {diagnosticResult.diagnostics.fallbackUsed ? <Badge variant="outline">使用宽松补召回</Badge> : null}
                        <span className="text-xs text-muted-foreground">
                          词项：{diagnosticResult.diagnostics.queryTerms.join('、') || '无'}
                        </span>
                      </div>

                      <section className="overflow-hidden rounded-md border border-border">
                        <div className="flex items-center justify-between border-b border-border px-3 py-2">
                          <span className="text-sm font-medium text-foreground">候选排序</span>
                          <span className="text-xs text-muted-foreground">展示 {diagnosticResult.diagnostics.candidates.length} 条</span>
                        </div>
                        <div className="max-h-72 divide-y divide-border overflow-y-auto">
                          {diagnosticResult.diagnostics.candidates.map((candidate, index) => (
                            <div key={candidate.chunkId} className="flex min-w-0 items-start gap-3 px-3 py-2.5">
                              <span className="w-6 shrink-0 text-right font-mono text-xs text-muted-foreground">{index + 1}</span>
                              <div className="min-w-0 flex-1">
                                <div className="flex min-w-0 items-center gap-2">
                                  <span className="truncate text-sm font-medium text-foreground" title={candidate.title}>{candidate.title}</span>
                                  {candidate.selected ? <Badge variant="secondary">已返回</Badge> : <Badge variant="outline">未返回</Badge>}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
                                  <span>总分 {candidate.final.toFixed(4)}</span>
                                  <span>融合 {candidate.fusion.toFixed(4)}</span>
                                  <span>加权 {candidate.boost.toFixed(4)}</span>
                                  <span>BM25 {candidate.fts.toFixed(2)}</span>
                                  <span>覆盖 {formatPercent(candidate.queryCoverage)}</span>
                                  <span>{candidate.fallbackMode === 'all' ? '严格' : candidate.fallbackMode === 'any' ? '宽松' : '字面'}</span>
                                  <span>命中 {candidate.matchedFields.map((field) => ({ title: '标题', path: '路径', heading: '章节', body: '正文' })[field]).join('、')}</span>
                                </div>
                              </div>
                              {candidate.selected ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="icon-sm"
                                      className="shrink-0"
                                      onClick={() => {
                                        const target = diagnosticResult.items.find((item) => item.chunkId === candidate.chunkId);
                                        if (target) void saveEvaluationSample(target, diagnosticQuery);
                                      }}
                                      aria-label={`将 ${candidate.title} 设为评测目标`}
                                    >
                                      <FlaskConical className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>设为评测目标</TooltipContent>
                                </Tooltip>
                              ) : null}
                            </div>
                          ))}
                          {diagnosticResult.diagnostics.candidates.length === 0 ? (
                            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                              {diagnosticReasonLabel(diagnosticResult.diagnostics.reason)}
                            </div>
                          ) : null}
                        </div>
                      </section>

                      {diagnosticResult.diagnostics.coverageRejectedCount > 0 ? (
                        <section className="overflow-hidden rounded-md border border-border">
                          <div className="flex items-center justify-between border-b border-border px-3 py-2">
                            <span className="text-sm font-medium text-foreground">覆盖率过滤</span>
                            <span className="text-xs text-muted-foreground">{diagnosticResult.diagnostics.coverageRejectedCount} 条</span>
                          </div>
                          <div className="max-h-40 divide-y divide-border overflow-y-auto">
                            {(diagnosticResult.diagnostics.coverageRejected || []).map((candidate) => (
                              <div key={candidate.chunkId} className="flex min-w-0 items-center justify-between gap-3 px-3 py-2 text-xs">
                                <span className="truncate text-foreground" title={candidate.title}>{candidate.title}</span>
                                <span className="shrink-0 text-muted-foreground">词项覆盖 {formatPercent(candidate.queryCoverage)}</span>
                              </div>
                            ))}
                          </div>
                        </section>
                      ) : null}
                    </>
                  ) : (
                    <div className="py-16 text-center text-sm text-muted-foreground">运行一次检索后显示候选与排序信息</div>
                  )}

                  <section className="overflow-hidden rounded-md border border-border">
                    <div className="border-b border-border px-3 py-2 text-sm font-medium text-foreground">运行指标</div>
                    <div className="divide-y divide-border">
                      {(overview?.diagnostics.operations || []).map((operation) => (
                        <div key={operation.kind} className="grid grid-cols-2 items-center gap-x-3 gap-y-1 px-3 py-2 text-xs sm:grid-cols-[minmax(100px,1fr)_repeat(4,minmax(64px,auto))]">
                          <span className="col-span-2 truncate font-medium text-foreground sm:col-span-1">{({ search: '检索', parse: '解析', 'parse-error': '解析失败', 'parse-cache-hit': '缓存命中' } as Record<string, string>)[operation.kind] || operation.kind}</span>
                          <span className="text-muted-foreground">{operation.count} 次</span>
                          <span className="text-muted-foreground">P50 {operation.p50DurationMs.toFixed(1)} ms</span>
                          <span className="text-muted-foreground">P95 {operation.p95DurationMs.toFixed(1)} ms</span>
                          <span className="text-muted-foreground">无结果 {operation.noResultCount}</span>
                        </div>
                      ))}
                      {(overview?.diagnostics.operations || []).length === 0 ? (
                        <div className="px-4 py-6 text-center text-sm text-muted-foreground">暂无运行指标</div>
                      ) : null}
                    </div>
                    <div className="border-t border-border px-3 py-2 text-xs text-muted-foreground">
                      解析缓存 {overview?.diagnostics.parseCache.entries || 0} 项 · {formatBytes(overview?.diagnostics.parseCache.bytes)} · 命中 {overview?.diagnostics.parseCache.hits || 0} 次
                    </div>
                  </section>
                </div>
              ) : (
                <div className="space-y-5 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="text-sm text-muted-foreground">{evaluationOverview?.cases.length || 0} 个样例</span>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={diagnosticsLoading || !diagnosticQuery.trim()}
                        onClick={() => void saveEvaluationSample(null)}
                      >
                        <FlaskConical className="h-4 w-4" />记录无结果预期
                      </Button>
                      <Button
                        size="sm"
                        disabled={evaluationRunning || !evaluationOverview?.cases.length}
                        onClick={() => void runEvaluation()}
                      >
                        {evaluationRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                        运行全部
                      </Button>
                    </div>
                  </div>

                  {evaluationOverview?.latestRun ? (
                    <div className="grid grid-cols-2 divide-x divide-y divide-border overflow-hidden rounded-md border border-border sm:grid-cols-6 sm:divide-y-0">
                      {[
                        ['通过', `${evaluationOverview.latestRun.summary.passedCases}/${evaluationOverview.latestRun.summary.cases}`],
                        ['命中首位', formatPercent(evaluationOverview.latestRun.summary.hitAt1)],
                        ['命中前五', formatPercent(evaluationOverview.latestRun.summary.hitAt5)],
                        ['平均倒数排名', evaluationOverview.latestRun.summary.mrr.toFixed(2)],
                        ['P95', `${evaluationOverview.latestRun.summary.latencyP95Ms.toFixed(1)} ms`],
                        ['重复证据', formatPercent(evaluationOverview.latestRun.summary.duplicateEvidenceRate)],
                      ].map(([label, value]) => (
                        <div key={label} className="min-w-0 px-3 py-2.5">
                          <div className="text-[11px] text-muted-foreground">{label}</div>
                          <div className="mt-0.5 truncate text-sm font-medium text-foreground">{value}</div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  <section className="overflow-hidden rounded-md border border-border">
                    <div className="border-b border-border px-3 py-2 text-sm font-medium text-foreground">评测样例</div>
                    <div className="divide-y divide-border">
                      {(evaluationOverview?.cases || []).map((entry) => {
                        const detail = evaluationOverview?.latestRun?.details?.find((item) => item.caseId === entry.id);
                        return (
                          <div key={entry.id} className="flex min-w-0 items-start gap-3 px-3 py-3">
                            {detail ? (
                              detail.passed
                                ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                                : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                            ) : <FlaskConical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />}
                            <div className="min-w-0 flex-1">
                              {editingEvaluationCaseId === entry.id ? (
                                <Input
                                  value={evaluationQueryDraft}
                                  className="h-8"
                                  maxLength={500}
                                  autoFocus
                                  aria-label="评测问题"
                                  onChange={(event) => setEvaluationQueryDraft(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') void saveEditedEvaluationSample();
                                    if (event.key === 'Escape') setEditingEvaluationCaseId(null);
                                  }}
                                />
                              ) : (
                                <div className="truncate text-sm font-medium text-foreground" title={entry.query}>{entry.query}</div>
                              )}
                              <div className="mt-0.5 truncate text-xs text-muted-foreground">
                                {entry.expectedResourceId
                                  ? `预期：${entry.expectedResourceTitle || '资源已移除'}`
                                  : '预期：无结果'}
                                {detail ? ` · ${detail.resultRank ? `排名 ${detail.resultRank}` : diagnosticReasonLabel(detail.reason)}` : ''}
                              </div>
                            </div>
                            {editingEvaluationCaseId === entry.id ? (
                              <>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" disabled={!evaluationQueryDraft.trim()} onClick={() => void saveEditedEvaluationSample()} aria-label="保存评测问题">
                                      <Save className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>保存</TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button variant="ghost" size="icon-sm" onClick={() => setEditingEvaluationCaseId(null)} aria-label="取消编辑评测问题">
                                      <X className="h-4 w-4" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>取消</TooltipContent>
                                </Tooltip>
                              </>
                            ) : (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <Button
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => {
                                      setEditingEvaluationCaseId(entry.id);
                                      setEvaluationQueryDraft(entry.query);
                                    }}
                                    aria-label={`编辑评测样例 ${entry.query}`}
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </Button>
                                </TooltipTrigger>
                                <TooltipContent>编辑问题</TooltipContent>
                              </Tooltip>
                            )}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button variant="ghost" size="icon-sm" onClick={() => void deleteEvaluationSample(entry.id)} aria-label={`删除评测样例 ${entry.query}`}>
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>删除样例</TooltipContent>
                            </Tooltip>
                          </div>
                        );
                      })}
                      {diagnosticsLoading && !evaluationOverview ? (
                        <div className="flex items-center justify-center px-4 py-10 text-sm text-muted-foreground">
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />正在读取评测样例
                        </div>
                      ) : null}
                      {!diagnosticsLoading && !evaluationOverview?.cases.length ? (
                        <div className="px-4 py-10 text-center text-sm text-muted-foreground">从检索结果中选择目标，建立第一个评测样例</div>
                      ) : null}
                    </div>
                  </section>

                  {(evaluationOverview?.recentRuns.length || 0) > 0 ? (
                    <section className="overflow-hidden rounded-md border border-border">
                      <div className="border-b border-border px-3 py-2 text-sm font-medium text-foreground">最近运行</div>
                      <div className="divide-y divide-border">
                        {evaluationOverview?.recentRuns.slice(0, 10).map((run) => (
                          <div key={run.id} className="grid grid-cols-[minmax(120px,1fr)_repeat(3,auto)] items-center gap-4 px-3 py-2 text-xs">
                            <span className="truncate text-muted-foreground">{formatTime(run.createdAt)}</span>
                            <span className="text-foreground">通过 {run.summary.passedCases}/{run.summary.cases}</span>
                            <span className="text-muted-foreground">前五 {formatPercent(run.summary.hitAt5)}</span>
                            <span className="text-muted-foreground">P95 {run.summary.latencyP95Ms.toFixed(1)} ms</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ) : null}
                </div>
              )}
            </ScrollArea>
          </div>
        </div>
      ) : null}

      {collectionEditor ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target && !busyAction) setCollectionEditor(null);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-label={collectionEditor.mode === 'create' ? '新建资料集' : '编辑资料集'}
            className="w-full max-w-md overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
            onSubmit={(event) => {
              event.preventDefault();
              void saveCollection();
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && !busyAction) setCollectionEditor(null);
            }}
          >
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <FolderPlus className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-foreground">
                  {collectionEditor.mode === 'create' ? '新建资料集' : '编辑资料集'}
                </h2>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  资料集用于组织资料，并限定对话检索范围。
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 shrink-0 rounded-md"
                disabled={Boolean(busyAction)}
                onClick={() => setCollectionEditor(null)}
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <div className="space-y-4 px-5 py-4">
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">资料集名称</span>
                <Input
                  ref={collectionNameInputRef}
                  value={collectionName}
                  maxLength={80}
                  placeholder="例如：产品资料"
                  disabled={Boolean(busyAction)}
                  aria-invalid={Boolean(collectionFormError)}
                  onChange={(event) => {
                    setCollectionName(event.target.value);
                    if (collectionFormError) setCollectionFormError('');
                  }}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm font-medium text-foreground">说明（选填）</span>
                <Textarea
                  value={collectionDescription}
                  maxLength={500}
                  rows={3}
                  placeholder="简要说明这个资料集包含的内容"
                  disabled={Boolean(busyAction)}
                  onChange={(event) => setCollectionDescription(event.target.value)}
                />
              </label>
              {collectionFormError ? (
                <div className="flex items-start gap-2 text-sm text-destructive" role="alert">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{collectionFormError}</span>
                </div>
              ) : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
              <Button type="button" variant="outline" disabled={Boolean(busyAction)} onClick={() => setCollectionEditor(null)}>
                取消
              </Button>
              <Button type="submit" disabled={Boolean(busyAction)}>
                {busyAction ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {collectionEditor.mode === 'create' ? '创建' : '保存'}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {extensionsOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setExtensionsOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="资料库扩展"
            className="flex max-h-[min(720px,calc(100vh-32px))] w-full max-w-lg flex-col overflow-hidden rounded-lg border border-border bg-background shadow-2xl"
          >
            <div className="flex items-start gap-3 border-b border-border px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <PackagePlus className="h-4 w-4" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-base font-semibold text-foreground">资料库扩展</h2>
                  {extensionStatus ? (
                    <Badge variant={extensionStatus.status === 'error' ? 'destructive' : 'secondary'}>
                      {extensionStatusLabel(extensionInstalling ? 'installing' : extensionStatus.status)}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  安装增强型文档解析能力，用于复杂的文字文档、PDF、演示文稿与表格。
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="h-8 w-8 shrink-0 rounded-md"
                onClick={() => setExtensionsOpen(false)}
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>

            <ScrollArea className="min-h-0 flex-1">
              <div className="space-y-4 px-5 py-4">
                {extensionLoading && !extensionStatus ? (
                  <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />正在检查扩展
                  </div>
                ) : (
                  <div className="divide-y divide-border rounded-md border border-border">
                    {(extensionStatus?.packages || []).map((entry) => (
                      <label key={entry.id} className="flex cursor-pointer items-center gap-3 px-3 py-3">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-primary"
                          checked={selectedExtensionIds.includes(entry.id)}
                          disabled={extensionInstalling}
                          aria-label={`选择${entry.label}`}
                          onChange={(event) => {
                            setSelectedExtensionIds((current) => event.target.checked
                              ? [...current, entry.id]
                              : current.filter((id) => id !== entry.id));
                          }}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-medium text-foreground">{entry.label}</div>
                          <div className="mt-0.5 text-xs leading-5 text-muted-foreground">{entry.description}</div>
                          <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{entry.spec}</div>
                        </div>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {entry.installed ? (
                            <span className="inline-flex items-center gap-1 text-emerald-600">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {entry.version || '已安装'}
                            </span>
                          ) : '未安装'}
                        </span>
                      </label>
                    ))}
                  </div>
                )}

                {extensionStatus?.error ? (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive" role="alert">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span className="min-w-0 whitespace-pre-wrap break-words">{extensionStatus.error}</span>
                  </div>
                ) : null}

                <div className="rounded-md border border-border bg-muted/25 px-3 py-2.5 text-xs leading-5 text-muted-foreground">
                  扩展会安装到受管 Python 的资料库扩展环境，不写入基础运行时或系统 Python。首次安装需要联网下载，可能占用数百 MB，耗时取决于网络速度。安装成功后会自动重建资料索引。
                </div>
              </div>
            </ScrollArea>

            <div className="flex items-center justify-between gap-3 border-t border-border px-5 py-3">
              <span className="min-w-0 truncate text-xs text-muted-foreground">
                {extensionStatus?.runtimeAvailable
                  ? `受管 Python ${extensionStatus.pythonVersion}`
                  : '受管 Python 不可用'}
              </span>
              <div className="flex shrink-0 gap-2">
                <Button type="button" variant="outline" onClick={() => setExtensionsOpen(false)}>关闭</Button>
                <Button
                  type="button"
                  disabled={extensionLoading || extensionInstalling || extensionStatus?.status === 'installing' || selectedExtensionIds.length === 0 || extensionStatus?.runtimeAvailable === false}
                  onClick={() => void installExtensions()}
                >
                  {extensionInstalling ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {extensionStatus?.status === 'installing'
                    ? '后台安装中'
                    : extensionStatus?.status === 'ready'
                      ? '重新安装所选'
                      : '安装所选'}
                  {selectedExtensionIds.length > 0 ? `（${selectedExtensionIds.length}）` : ''}
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
