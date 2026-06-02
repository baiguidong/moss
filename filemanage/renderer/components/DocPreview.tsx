/**
 * 文档预览组件
 */

import * as React from 'react';
import { FileText, Download, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface DocPreviewProps {
  filePath: string;
  fileType: string;
  className?: string;
}

export function DocPreview({ filePath, fileType, className }: DocPreviewProps) {
  const [content, setContent] = React.useState<string>('');
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    const loadContent = async () => {
      setLoading(true);
      setError(null);

      try {
        // 文本文件直接读取
        if (['.txt', '.md', '.json', '.csv'].includes(fileType)) {
          const result = await window.electronAPI?.ipcInvoke('fileManager:readFileContent', { filePath });
          if (result?.success) {
            setContent(result.content);
          } else {
            setError('无法读取文件内容');
          }
        } else {
          // 其他文件类型显示信息
          setContent('');
        }
      } catch (err) {
        setError('加载失败');
      } finally {
        setLoading(false);
      }
    };

    loadContent();
  }, [filePath, fileType]);

  // 打开外部应用
  const openExternal = async () => {
    try {
      await window.electronAPI?.ipcInvoke('shell:openExternal', { path: filePath });
    } catch (err) {
      console.error('Failed to open external:', err);
    }
  };

  // 获取文件图标
  const getFileIcon = () => {
    const iconMap: Record<string, string> = {
      '.pdf': '📄',
      '.doc': '📝',
      '.docx': '📝',
      '.xls': '📊',
      '.xlsx': '📊',
      '.ppt': '📽️',
      '.pptx': '📽️',
      '.txt': '📃',
      '.md': '📝',
    };

    return iconMap[fileType] || '📄';
  };

  if (loading) {
    return (
      <div className={cn('flex items-center justify-center h-64', className)}>
        <div className="animate-spin text-primary">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-64', className)}>
        <FileText className="h-12 w-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={openExternal}>
          <ExternalLink className="h-4 w-4 mr-2" />
          使用外部应用打开
        </Button>
      </div>
    );
  }

  // PDF 等文件显示预览提示
  if (['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx'].includes(fileType)) {
    return (
      <div className={cn('flex flex-col items-center justify-center h-64', className)}>
        <div className="text-6xl mb-4">{getFileIcon()}</div>
        <p className="text-lg font-medium mb-2">文档预览</p>
        <p className="text-sm text-muted-foreground mb-4">
          此文件类型需要外部应用打开
        </p>
        <Button variant="outline" onClick={openExternal}>
          <ExternalLink className="h-4 w-4 mr-2" />
          打开文件
        </Button>
      </div>
    );
  }

  // 文本文件显示内容
  return (
    <div className={cn('p-4 bg-muted/30 rounded-lg overflow-auto', className)}>
      <pre className="text-sm whitespace-pre-wrap font-mono">{content}</pre>
    </div>
  );
}

export default DocPreview;