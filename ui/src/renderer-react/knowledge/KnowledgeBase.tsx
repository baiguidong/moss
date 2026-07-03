/**
 * 知识库模块 - 主界面
 * 选择文档目录 -> 调 MinerU 解析 -> 结构化文本落库 -> 展示 / 预览。
 * MinerU 服务由用户单独启动,这里只作为客户端连接。
 */

import * as React from 'react';
import {
  FolderUp,
  Play,
  Square,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
  FileText,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { knowledgeAPI, type KbBackend, type KbDocument, type KbScanProgress } from './ipc/knowledge.ipc';

type ConnState = 'unknown' | 'testing' | 'ok' | 'fail';

const LANG_OPTIONS = [
  { id: 'ch', label: '中文' },
  { id: 'en', label: 'English' },
];

const BACKEND_OPTIONS: { id: KbBackend; label: string; desc: string }[] = [
  {
    id: 'pipeline',
    label: '流水线',
    desc: '通用流水线,多语言、无幻觉,可纯 CPU 运行,资源要求低。适合先验证。',
  },
  {
    id: 'hybrid-engine',
    label: '混合',
    desc: '文本直接抽取 + 扫描页 OCR 回退,多语言、幻觉低。MinerU 默认,较均衡。',
  },
  {
    id: 'vlm-engine',
    label: '大模型',
    desc: '本地视觉大模型(MinerU2.5)端到端解析,精度最高。仅支持中英文,需要 GPU。',
  },
];

function statusLabel(status: KbDocument['status']): string {
  switch (status) {
    case 'done':
      return '已解析';
    case 'parsing':
      return '解析中';
    case 'error':
      return '失败';
    default:
      return '待处理';
  }
}

export function KnowledgeBase() {
  const [serverUrl, setServerUrl] = React.useState('');
  const [conn, setConn] = React.useState<ConnState>('unknown');
  const [connError, setConnError] = React.useState('');

  const [dir, setDir] = React.useState('');
  const [lang, setLang] = React.useState('ch');
  const [recursive, setRecursive] = React.useState(true);
  const [backend, setBackend] = React.useState<KbBackend>('pipeline');

  const [scanning, setScanning] = React.useState(false);
  const [progress, setProgress] = React.useState<KbScanProgress | null>(null);

  const [docs, setDocs] = React.useState<KbDocument[]>([]);
  const [selectedDoc, setSelectedDoc] = React.useState<KbDocument | null>(null);
  const [markdown, setMarkdown] = React.useState('');
  const [mdLoading, setMdLoading] = React.useState(false);
  const activeDocReq = React.useRef<number | null>(null);

  const refreshDocs = React.useCallback(async () => {
    try {
      const rows = await knowledgeAPI.getDocuments();
      setDocs(rows || []);
    } catch (err) {
      console.error('[Knowledge] getDocuments failed:', err);
    }
  }, []);

  // 读设置里的 MinerU 服务地址(仅用于展示)
  React.useEffect(() => {
    window.agentDesktop
      .getSettings()
      .then((s) => setServerUrl(s?.mineru?.serverUrl || ''))
      .catch(() => {});
    refreshDocs();
  }, [refreshDocs]);

  // 监听解析进度
  React.useEffect(() => {
    const unsub = knowledgeAPI.onScanProgress((data) => {
      setProgress(data);
      if (data.status === 'completed' || data.status === 'cancelled' || data.status === 'error') {
        setScanning(false);
        refreshDocs();
      }
    });
    return unsub;
  }, [refreshDocs]);

  const handleTestConnection = async () => {
    setConn('testing');
    setConnError('');
    try {
      const res = await knowledgeAPI.testConnection(serverUrl || undefined);
      if (res.ok) {
        setConn('ok');
      } else {
        setConn('fail');
        setConnError(res.error || '连接失败');
      }
    } catch (err) {
      setConn('fail');
      setConnError(err instanceof Error ? err.message : String(err));
    }
  };

  const handlePickDir = async () => {
    try {
      const picked = await window.agentDesktop.pickDirectory();
      if (picked) setDir(picked);
    } catch (err) {
      console.error('[Knowledge] pickDirectory failed:', err);
    }
  };

  const handleStartScan = async () => {
    if (!dir) return;
    setScanning(true);
    setProgress(null);
    try {
      const res = await knowledgeAPI.startScan({ dir, lang, recursive, backend, serverUrl: serverUrl || undefined });
      if (!res.started) {
        setScanning(false);
        setProgress({
          total: 0,
          processed: 0,
          skipped: 0,
          failed: 0,
          currentFile: '',
          status: 'error',
          error: res.error,
        });
      }
    } catch (err) {
      setScanning(false);
      console.error('[Knowledge] startScan failed:', err);
    }
  };

  const handleStopScan = async () => {
    await knowledgeAPI.stopScan();
  };

  const handleOpenDoc = async (doc: KbDocument) => {
    setSelectedDoc(doc);
    activeDocReq.current = doc.id;
    if (doc.status !== 'done') {
      setMarkdown('');
      return;
    }
    setMdLoading(true);
    try {
      const res = await knowledgeAPI.getDocumentMarkdown(doc.id);
      // Ignore a stale response if the user has since selected another doc.
      if (activeDocReq.current !== doc.id) return;
      setMarkdown(res.markdown ?? (res.error ? `读取失败: ${res.error}` : ''));
    } finally {
      if (activeDocReq.current === doc.id) setMdLoading(false);
    }
  };

  const progressValue =
    progress && progress.total > 0 ? Math.round((progress.processed / progress.total) * 100) : 0;

  return (
    <div className="flex h-full flex-col">
      {/* 服务状态栏 */}
      <div className="flex items-center gap-3 border-b border-border/40 px-4 py-2">
        {conn === 'ok' ? (
          <Wifi className="h-4 w-4 text-green-500" />
        ) : conn === 'fail' ? (
          <WifiOff className="h-4 w-4 text-destructive" />
        ) : (
          <Wifi className="h-4 w-4 text-muted-foreground" />
        )}
        <span className="text-sm text-muted-foreground">
          MinerU 服务: {serverUrl || 'http://127.0.0.1:8000 (默认)'}
        </span>
        <Button variant="outline" size="sm" onClick={handleTestConnection} disabled={conn === 'testing'}>
          {conn === 'testing' ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="mr-2 h-4 w-4" />
          )}
          测试连接
        </Button>
        {conn === 'ok' && <span className="text-xs text-green-500">已连接</span>}
        {conn === 'fail' && <span className="text-xs text-destructive truncate">{connError}</span>}
      </div>

      <div className="flex min-h-0 flex-1">
        {/* 左侧:控制 + 文档列表 */}
        <div className="flex w-1/2 flex-col border-r border-border/40">
          {/* 解析控制 */}
          <div className="space-y-3 border-b border-border/40 p-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={handlePickDir} disabled={scanning}>
                <FolderUp className="mr-2 h-4 w-4" />
                选择目录
              </Button>
              <span className="flex-1 truncate text-sm text-muted-foreground">
                {dir || '未选择目录'}
              </span>
            </div>

            {/* 解析方式 */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">解析方式</span>
                {BACKEND_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setBackend(opt.id)}
                    disabled={scanning}
                    className={cn(
                      'rounded-full border px-3 py-0.5 text-sm transition-colors disabled:opacity-50',
                      backend === opt.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 text-muted-foreground hover:bg-muted/50'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {BACKEND_OPTIONS.find((o) => o.id === backend)?.desc}
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <span className={cn('text-sm text-muted-foreground', backend !== 'pipeline' && 'opacity-40')}>
                  语言
                </span>
                {LANG_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    onClick={() => setLang(opt.id)}
                    disabled={scanning || backend !== 'pipeline'}
                    title={backend !== 'pipeline' ? '语言选项仅对「流水线」方式生效' : undefined}
                    className={cn(
                      'rounded-full border px-3 py-0.5 text-sm transition-colors disabled:opacity-40',
                      lang === opt.id
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'border-border/60 text-muted-foreground hover:bg-muted/50'
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  checked={recursive}
                  onChange={(e) => setRecursive(e.target.checked)}
                  disabled={scanning}
                />
                包含子目录
              </label>
            </div>

            <div className="flex items-center gap-2">
              {scanning ? (
                <Button variant="destructive" size="sm" onClick={handleStopScan}>
                  <Square className="mr-2 h-4 w-4" />
                  停止
                </Button>
              ) : (
                <Button size="sm" onClick={handleStartScan} disabled={!dir}>
                  <Play className="mr-2 h-4 w-4" />
                  开始解析
                </Button>
              )}
            </div>

            {/* 进度 */}
            {progress && (
              <div className="rounded-lg border border-border/40 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {scanning ? (
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                    ) : progress.status === 'completed' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                    ) : progress.status === 'error' ? (
                      <XCircle className="h-4 w-4 text-destructive" />
                    ) : null}
                    <span className="text-sm">
                      {scanning
                        ? '解析中...'
                        : progress.status === 'completed'
                          ? '已完成'
                          : progress.status === 'cancelled'
                            ? '已取消'
                            : progress.status === 'error'
                              ? '出错'
                              : ''}
                    </span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {progress.processed} / {progress.total}
                  </span>
                </div>
                <Progress value={progressValue} className="mb-2" />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>跳过 {progress.skipped} · 失败 {progress.failed}</span>
                </div>
                {progress.currentFile && (
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    当前: {progress.currentFile}
                  </div>
                )}
                {progress.error && (
                  <div className="mt-1 text-xs text-destructive">{progress.error}</div>
                )}
              </div>
            )}
          </div>

          {/* 文档列表 */}
          <div className="flex items-center justify-between px-4 py-2">
            <h3 className="text-sm font-medium">已解析文档 ({docs.length})</h3>
            <Button variant="ghost" size="sm" onClick={refreshDocs}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
          <ScrollArea className="flex-1">
            <div className="space-y-1 px-4 pb-4">
              {docs.length === 0 ? (
                <p className="text-sm text-muted-foreground">暂无文档,选择目录开始解析</p>
              ) : (
                docs.map((doc) => (
                  <button
                    key={doc.id}
                    onClick={() => handleOpenDoc(doc)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left transition-colors',
                      selectedDoc?.id === doc.id
                        ? 'border-primary bg-primary/5'
                        : 'border-border/40 hover:bg-muted/50'
                    )}
                  >
                    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{doc.file_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {doc.page_count} 页 · {doc.block_count} 块
                        {doc.parse_seconds != null && ` · ${doc.parse_seconds.toFixed(1)}s`}
                      </div>
                    </div>
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-2 py-0.5 text-xs',
                        doc.status === 'done' && 'bg-green-500/10 text-green-500',
                        doc.status === 'parsing' && 'bg-primary/10 text-primary',
                        doc.status === 'error' && 'bg-destructive/10 text-destructive',
                        doc.status === 'pending' && 'bg-muted text-muted-foreground'
                      )}
                    >
                      {statusLabel(doc.status)}
                    </span>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </div>

        {/* 右侧:Markdown 预览 */}
        <div className="flex w-1/2 flex-col">
          {selectedDoc ? (
            <>
              <div className="border-b border-border/40 px-4 py-2">
                <div className="truncate text-sm font-medium">{selectedDoc.file_name}</div>
                <div className="truncate text-xs text-muted-foreground">{selectedDoc.source_path}</div>
              </div>
              <ScrollArea className="flex-1">
                <div className="p-4">
                  {mdLoading ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> 加载中...
                    </div>
                  ) : selectedDoc.status === 'error' ? (
                    <div className="text-sm text-destructive">{selectedDoc.error || '解析失败'}</div>
                  ) : selectedDoc.status !== 'done' ? (
                    <div className="text-sm text-muted-foreground">该文档尚未解析完成</div>
                  ) : (
                    <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                      {markdown}
                    </pre>
                  )}
                </div>
              </ScrollArea>
            </>
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              选择左侧文档查看解析结果
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default KnowledgeBase;
