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
import { mediaUrl } from '../lib/mediaUrl';

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
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  // 直接走 moss-media:// 协议加载原图, 切换图片时重置状态
  const imageUrl = mediaUrl(src);
  React.useEffect(() => {
    setLoading(true);
    setError(null);
    setZoom(1);
    setRotation(0);
  }, [src]);

  // 在 document 捕获阶段拦截键盘: Esc 只关闭本预览, 阻止冒泡到宿主窗口(否则会误关整个窗口)
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose?.();
      } else if (e.key === 'ArrowLeft' && hasPrev) {
        e.preventDefault();
        e.stopPropagation();
        onPrev?.();
      } else if (e.key === 'ArrowRight' && hasNext) {
        e.preventDefault();
        e.stopPropagation();
        onNext?.();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

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
      onClick={(e) => {
        // 点击背景空白处关闭(点到图片/控制栏不关)
        if (e.target === e.currentTarget) onClose?.();
      }}
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
        {imageUrl && !error && (
          <img
            src={imageUrl}
            alt={alt}
            onLoad={() => setLoading(false)}
            onError={() => {
              setLoading(false);
              setError('加载图片失败');
            }}
            style={{
              transform: `scale(${zoom}) rotate(${rotation}deg)`,
              visibility: loading ? 'hidden' : 'visible',
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

    </div>
  );
}

export default ImageViewer;
