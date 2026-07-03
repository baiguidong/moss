/**
 * 扫描视图组件
 */

import * as React from 'react';
import {
  FolderUp,
  Play,
  Pause,
  RefreshCw,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import type { ScanTask, ScanProgress } from './ipc/types';

interface ScanViewProps {
  onScanComplete?: () => void;
}

const FILE_TYPE_OPTIONS = [
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
  { id: 'audio', label: '音频' },
  { id: 'document', label: '文档' },
  { id: 'other', label: '其他' },
];
const COMMON_TYPES = ['image', 'video', 'audio', 'document'];

export function ScanView({ onScanComplete }: ScanViewProps) {
  const [selectedPaths, setSelectedPaths] = React.useState<string[]>([]);
  const [fileTypes, setFileTypes] = React.useState<string[]>(COMMON_TYPES);
  const [currentTask, setCurrentTask] = React.useState<ScanTask | null>(null);
  const [scanTasks, setScanTasks] = React.useState<ScanTask[]>([]);
  const [isScanning, setIsScanning] = React.useState(false);
  const [scanProgress, setScanProgress] = React.useState<ScanProgress | null>(null);

  // 初始化 fileManager API
  React.useEffect(() => {
    if (!window.fileManager) {
      // 动态导入 IPC 模块
      import('./ipc/fileManager.ipc');
    }
  }, []);

  // 加载历史扫描任务
  React.useEffect(() => {
    const loadTasks = async () => {
      try {
        const tasks = await window.fileManager?.getScanTasks();
        if (tasks) {
          setScanTasks(tasks);
          // 检查是否有正在运行的任务
          const runningTask = tasks.find(t => t.status === 'running');
          if (runningTask) {
            setCurrentTask(runningTask);
            setIsScanning(true);
          }
        }
      } catch (err) {
        console.error('Failed to load scan tasks:', err);
      }
    };
    loadTasks();
  }, []);

  // 监听扫描进度
  React.useEffect(() => {
    let unsubscribe: (() => void) | undefined;

    const setupListener = async () => {
      // 等待 fileManager 初始化
      if (!window.fileManager) {
        await import('./ipc/fileManager.ipc');
      }

      if (window.fileManager?.onScanProgress) {
        unsubscribe = window.fileManager.onScanProgress((progress: ScanProgress) => {
          console.log('[ScanView] Progress:', progress);
          setScanProgress(progress);
          setCurrentTask((prev) => {
            if (!prev) {
              // 创建新的任务对象
              return {
                id: progress.taskId,
                name: '扫描中...',
                source_paths: [],
                target_path: '',
                status: progress.status as ScanTask['status'],
                progress: progress.progress,
                total_files: progress.totalFiles,
                processed_files: progress.processedFiles,
                error_files: progress.errorFiles,
                created_at: new Date().toISOString(),
              };
            }
            if (prev.id !== progress.taskId) return prev;
            return {
              ...prev,
              progress: progress.progress,
              total_files: progress.totalFiles,
              processed_files: progress.processedFiles,
              error_files: progress.errorFiles,
              status: progress.status as ScanTask['status'],
            };
          });

          if (progress.status === 'completed' || progress.status === 'cancelled' || progress.status === 'error') {
            setIsScanning(false);
            if (progress.status === 'completed') onScanComplete?.();
            // 刷新任务列表
            window.fileManager?.getScanTasks().then(tasks => {
              if (tasks) setScanTasks(tasks);
            });
          }
        });
      }
    };

    setupListener();

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [onScanComplete]);

  // 选择目录
  const handleSelectDirectory = async () => {
    try {
      const result = await window.agentDesktop.pickDirectory();
      if (result) {
        setSelectedPaths((prev) => [...prev, result]);
      }
    } catch (err) {
      console.error('Failed to select directory:', err);
    }
  };

  // 移除路径
  const handleRemovePath = (path: string) => {
    setSelectedPaths((prev) => prev.filter((p) => p !== path));
  };

  // 切换文件类型
  const toggleFileType = (id: string) => {
    setFileTypes((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };
  const allSelected = fileTypes.length === FILE_TYPE_OPTIONS.length;

  // 开始扫描
  const handleStartScan = async () => {
    if (selectedPaths.length === 0) return;

    setIsScanning(true);
    try {
      // 确保 fileManager 已初始化
      if (!window.fileManager) {
        await import('./ipc/fileManager.ipc');
      }

      // 创建扫描任务
      const task = await window.fileManager?.startScan(selectedPaths, {
        name: `扫描 ${new Date().toLocaleString()}`,
        recursive: true,
        fileTypes,
      });

      if (task) {
        console.log('[ScanView] Task created:', task);
        setCurrentTask(task as ScanTask);

        // 执行扫描 (worker 异步执行, executeScan 立即返回; 进度/完成由事件驱动)
        window.fileManager?.executeScan(task.id).then((result) => {
          console.log('[ScanView] Scan started:', result);
          if (result && (result as { error?: string }).error) {
            setIsScanning(false);
          }
        }).catch(err => {
          console.error('[ScanView] Scan error:', err);
          setIsScanning(false);
        });
      }
    } catch (err) {
      console.error('Failed to start scan:', err);
      setIsScanning(false);
    }
  };

  // 停止扫描
  const handleStopScan = async () => {
    if (!currentTask) return;
    await window.fileManager?.stopScan(currentTask.id);
    setIsScanning(false);
  };

  // 获取当前进度值
  const indeterminate = scanProgress?.indeterminate ?? (isScanning && (scanProgress?.totalFiles ?? 0) === 0);
  const progressValue = indeterminate ? undefined : (scanProgress?.progress ?? currentTask?.progress ?? 0);
  const processedFiles = scanProgress?.processedFiles ?? currentTask?.processed_files ?? 0;
  const totalFiles = scanProgress?.totalFiles ?? currentTask?.total_files ?? 0;

  return (
    <div className="flex h-full flex-col p-4">
      {/* 目录选择 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">扫描目录</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleSelectDirectory}
            disabled={isScanning}
          >
            <FolderUp className="mr-2 h-4 w-4" />
            选择目录
          </Button>
        </div>

        {/* 已选目录列表 */}
        <div className="space-y-2">
          {selectedPaths.length === 0 ? (
            <p className="text-sm text-muted-foreground">请选择要扫描的目录</p>
          ) : (
            selectedPaths.map((path) => (
              <div
                key={path}
                className="flex items-center justify-between rounded-md bg-muted/50 px-3 py-2"
              >
                <span className="text-sm truncate flex-1">{path}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleRemovePath(path)}
                  disabled={isScanning}
                >
                  <XCircle className="h-4 w-4" />
                </Button>
              </div>
            ))
          )}
        </div>
      </div>

      {/* 文件类型选择 */}
      <div className="mb-4">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium">文件类型</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFileTypes(allSelected ? COMMON_TYPES : FILE_TYPE_OPTIONS.map((o) => o.id))}
            disabled={isScanning}
            className="text-xs"
          >
            {allSelected ? '常用类型' : '全部'}
          </Button>
        </div>
        <div className="flex flex-wrap gap-2">
          {FILE_TYPE_OPTIONS.map((opt) => {
            const active = fileTypes.includes(opt.id);
            return (
              <button
                key={opt.id}
                onClick={() => toggleFileType(opt.id)}
                disabled={isScanning}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-50',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border/60 text-muted-foreground hover:bg-muted/50'
                )}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 扫描控制 */}
      <div className="mb-4">
        {isScanning ? (
          <Button variant="destructive" onClick={handleStopScan}>
            <Pause className="mr-2 h-4 w-4" />
            停止扫描
          </Button>
        ) : (
          <Button
            onClick={handleStartScan}
            disabled={selectedPaths.length === 0 || fileTypes.length === 0}
          >
            <Play className="mr-2 h-4 w-4" />
            开始扫描
          </Button>
        )}
      </div>

      {/* 扫描进度 */}
      {(currentTask || isScanning) && (
        <div className="mb-4 rounded-lg border border-border/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium">扫描进度</h4>
            <div className="flex items-center gap-2">
              {isScanning && (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              {!isScanning && currentTask?.status === 'completed' && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              <span className="text-sm text-muted-foreground">
                {isScanning ? '扫描中...' :
                 currentTask?.status === 'completed' ? '已完成' :
                 currentTask?.status || '准备中...'}
              </span>
            </div>
          </div>

          {indeterminate ? (
            <div className="mb-2 h-2 w-full overflow-hidden rounded-full bg-primary/20">
              <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
            </div>
          ) : (
            <Progress value={progressValue ?? 0} className="mb-2" />
          )}

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              {indeterminate
                ? `已发现 ${processedFiles} 个文件...`
                : `已处理: ${processedFiles} / ${totalFiles || '...'}`}
            </span>
            {(currentTask?.error_files ?? 0) > 0 && (
              <span className="text-destructive">错误: {currentTask?.error_files}</span>
            )}
          </div>

          {scanProgress?.currentFile && (
            <div className="mt-2 text-xs text-muted-foreground truncate">
              当前: {scanProgress.currentFile}
            </div>
          )}
        </div>
      )}

      {/* 历史扫描任务 */}
      <div className="flex-1 overflow-auto">
        <h3 className="text-sm font-medium mb-2">历史扫描</h3>
        <div className="space-y-2">
          {scanTasks.length === 0 ? (
            <p className="text-sm text-muted-foreground">暂无扫描记录</p>
          ) : (
            scanTasks.map((task) => (
              <div
                key={task.id}
                className="rounded-md border border-border/40 p-3"
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{task.name}</span>
                  <span className={cn(
                    'text-xs px-2 py-0.5 rounded-full',
                    task.status === 'completed' && 'bg-green-500/10 text-green-500',
                    task.status === 'running' && 'bg-primary/10 text-primary',
                    task.status === 'cancelled' && 'bg-muted text-muted-foreground'
                  )}>
                    {task.status}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {task.total_files} 文件 · {new Date(task.created_at).toLocaleString()}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

export default ScanView;
