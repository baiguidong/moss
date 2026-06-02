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
import type { ScanTask, ScanProgress } from '../ipc/types';

interface ScanViewProps {
  onScanComplete?: () => void;
}

export function ScanView({ onScanComplete }: ScanViewProps) {
  const [selectedPaths, setSelectedPaths] = React.useState<string[]>([]);
  const [currentTask, setCurrentTask] = React.useState<ScanTask | null>(null);
  const [scanTasks, setScanTasks] = React.useState<ScanTask[]>([]);
  const [isScanning, setIsScanning] = React.useState(false);

  // 加载历史扫描任务
  React.useEffect(() => {
    const loadTasks = async () => {
      try {
        const tasks = await window.fileManager?.getScanTasks();
        if (tasks) {
          setScanTasks(tasks);
        }
      } catch (err) {
        console.error('Failed to load scan tasks:', err);
      }
    };
    loadTasks();
  }, []);

  // 监听扫描进度
  React.useEffect(() => {
    if (!window.fileManager?.onScanProgress) return;

    const unsubscribe = window.fileManager.onScanProgress((progress: ScanProgress) => {
      setCurrentTask((prev) => {
        if (!prev || prev.id !== progress.taskId) return prev;
        return {
          ...prev,
          progress: progress.progress,
          total_files: progress.totalFiles,
          processed_files: progress.processedFiles,
          error_files: progress.errorFiles,
          status: progress.status as ScanTask['status'],
        };
      });

      if (progress.status === 'completed') {
        setIsScanning(false);
        onScanComplete?.();
      }
    });

    return unsubscribe;
  }, [onScanComplete]);

  // 选择目录
  const handleSelectDirectory = async () => {
    try {
      const result = await window.electronAPI.ipcInvoke('agent:pick-directory');
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

  // 开始扫描
  const handleStartScan = async () => {
    if (selectedPaths.length === 0) return;

    setIsScanning(true);
    try {
      // 创建扫描任务
      const task = await window.fileManager?.startScan(selectedPaths, {
        name: `扫描 ${new Date().toLocaleString()}`,
        recursive: true,
      });

      if (task) {
        setCurrentTask(task as ScanTask);

        // 执行扫描
        await window.fileManager?.executeScan(task.id);

        // 刷新任务列表
        const tasks = await window.fileManager?.getScanTasks();
        if (tasks) {
          setScanTasks(tasks);
        }
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
            disabled={selectedPaths.length === 0}
          >
            <Play className="mr-2 h-4 w-4" />
            开始扫描
          </Button>
        )}
      </div>

      {/* 扫描进度 */}
      {currentTask && (
        <div className="mb-4 rounded-lg border border-border/40 p-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-sm font-medium">扫描进度</h4>
            <div className="flex items-center gap-2">
              {currentTask.status === 'running' && (
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
              )}
              {currentTask.status === 'completed' && (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              <span className="text-sm text-muted-foreground">
                {currentTask.status === 'running' ? '扫描中...' :
                 currentTask.status === 'completed' ? '已完成' :
                 currentTask.status}
              </span>
            </div>
          </div>

          <Progress value={currentTask.progress} className="mb-2" />

          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>已处理: {currentTask.processed_files} / {currentTask.total_files}</span>
            {currentTask.error_files > 0 && (
              <span className="text-destructive">错误: {currentTask.error_files}</span>
            )}
          </div>
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