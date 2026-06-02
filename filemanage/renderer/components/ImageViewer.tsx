/**
 * 图片查看器组件
 */

import * as React from 'react';
import {
  ZoomIn,
  ZoomOut,
  RotateLeft,
  RotateRight,
  Maximize,
  ChevronLeft,
  ChevronRight,
  X,
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
      <div className="absolute top-4 left-1/2 -translate-x-1/2 flex items-center gap-2 rounded-lg bg-black/50 px-4 py-2">
        <Button variant="ghost" size="sm" onClick={handleZoomOut}>
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="text-sm text-white">{Math.round(zoom * 100)}%</span>
        <Button variant="ghost" size="sm" onClick={handleZoomIn}>
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleReset}>
          重置
        </Button>
        <Button variant="ghost" size="sm" onClick={handleRotateLeft}>
          <RotateLeft className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={handleRotateRight}>
          <RotateRight className="h-4 w-4" />
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

      {/* 图片 */}
      <div className="relative max-h-[80vh] max-w-[80vw] overflow-auto">
        <img
          src={src}
          alt={alt}
          style={{
            transform: `scale(${zoom}) rotate(${rotation}deg)`,
          }}
          className="max-h-full max-w-full object-contain transition-transform duration-200"
        />
      </div>

      {/* 导航按钮 */}
      {hasPrev && onPrev && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50"
          onClick={onPrev}
        >
          <ChevronLeft className="h-6 w-6" />
        </Button>
      )}

      {hasNext && onNext && (
        <Button
          variant="ghost"
          size="sm"
          className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50"
          onClick={onNext}
        >
          <ChevronRight className="h-6 w-6" />
        </Button>
      )}
    </div>
  );
}

export default ImageViewer;