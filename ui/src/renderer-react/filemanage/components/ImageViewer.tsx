/**
 * 图片查看器组件
 */

import * as React from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  Maximize,
  ChevronLeft,
  ChevronRight,
  X,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ImageViewerProps {
  src: string;
  alt?: string;
  onClose?: () => void;
  onPrev?: () => void;
  onNext?: () => void;
  hasPrev?: boolean;
  hasNext?: boolean;
}

export function ImageViewer({
  src,
  alt = '',
  onClose,
  onPrev,
  onNext,
  hasPrev = false,
  hasNext = false,
}: ImageViewerProps) {
  const [zoom, setZoom] = React.useState(1);
  const [rotation, setRotation] = React.useState(0);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // 加载图片
  React.useEffect(() => {
    const loadImage = async () => {
      setLoading(true);
      setError(null);

      try {
        // 如果已经是 data URL 或 http URL，直接使用
        if (src.startsWith('data:') || src.startsWith('http')) {
          setImageUrl(src);
          setLoading(false);
          return;
        }

        // 否则通过 IPC 读取本地文件
        if (window.fileManager?.readFile) {
          const result = await window.fileManager.readFile(src, true);
          if (result?.dataUrl) {
            setImageUrl(result.dataUrl);
          } else if (result?.error) {
            setError(result.error);
          }
        } else {
          // 降级方案：直接使用路径（可能在某些 Electron 配置下工作）
          setImageUrl(`file://${src}`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : '加载图片失败');
      } finally {
        setLoading(false);
      }
    };

    loadImage();
  }, [src]);

  const handleZoomIn = () => {
    setZoom(Math.min(zoom + 0.25, 4));
  };

  const handleZoomOut = () => {
    setZoom(Math.max(zoom - 0.25, 0.25));
  };

  const handleRotateLeft = () => {
    setRotation(rotation - 90);
  };

  const handleRotateRight = () => {
    setRotation(rotation + 90);
  };

  const handleReset = () => {
    setZoom(1);
    setRotation(0);
  };

  const handleFullscreen = () => {
    setIsFullscreen(!isFullscreen);
  };

  return (
    <div
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/90',
        isFullscreen && 'bg-black'
      )}
    >
      {/* 控制栏 */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-lg bg-black/50 px-4 py-2 z-10">
        <Button variant="ghost" size="sm" onClick={handleZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-sm text-white w-12 text-center">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={handleZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          重置
        </Button>
        <Button variant="ghost" size="sm" onClick={handleRotateLeft}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleRotateRight}>
          <RotateCw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleFullscreen}>
          <Maximize className="h-4 w-4" />
        </Button>
        {onClose && (
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* 图片内容 */}
      <div className="relative max-h-[80vh] max-w-[80vw] overflow-auto flex items-center justify-center">
        {loading && (
          <Loader2 className="h-8 w-8 animate-spin text-white" />
        )}
        {error && (
          <div className="text-center text-white">
            <p className="text-lg">加载失败</p>
            <p className="text-sm text-gray-400">{error}</p>
          </div>
        )}
        {imageUrl && !loading && !error && (
          <img
            src={imageUrl}
            alt={alt}
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
            }}
            className="max-h-full max-w-full object-contain transition-transform duration-200"
          />
        )}
      </div>

      {/* 导航按钮 */}
      {hasPrev && onPrev && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70"
          onClick={onPrev}
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
      )}

      {hasNext && onNext && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70"
          onClick={onNext}
        >
          <ChevronRight className="h-6 w-6" />
        </Button>
      )}

      {/* 键盘导航 */}
      <div
        tabIndex={0}
        className="sr-only"
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft' && hasPrev && onPrev) onPrev();
          if (e.key === 'ArrowRight' && hasNext && onNext) onNext();
          if (e.key === 'Escape' && onClose) onClose();
        }}
      />
    </div>
  );
}

export default ImageViewer;
