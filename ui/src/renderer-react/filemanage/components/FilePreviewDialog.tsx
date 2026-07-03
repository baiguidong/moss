/**
 * 文件预览对话框
 */

import * as React from 'react';
import { X, Image, Film, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ImageViewer } from './ImageViewer';
import { VideoPlayer } from './VideoPlayer';
import { DocPreview } from './DocPreview';
import { cn } from '@/lib/utils';
import type { FileManagerFile } from '../ipc/types';

interface FilePreviewDialogProps {
  file: FileManagerFile;
  files?: FileManagerFile[]; // 用于导航
  onClose: () => void;
  onNavigate?: (file: FileManagerFile) => void;
}

export function FilePreviewDialog({
  file,
  files = [],
  onClose,
  onNavigate,
}: FilePreviewDialogProps) {
  const currentIndex = files.findIndex((f) => f.id === file.id);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < files.length - 1;

  const handlePrev = () => {
    if (hasPrev && onNavigate) {
      onNavigate(files[currentIndex - 1]);
    }
  };

  const handleNext = () => {
    if (hasNext && onNavigate) {
      onNavigate(files[currentIndex + 1]);
    }
  };

  // 根据文件类型渲染预览
  const renderPreview = () => {
    switch (file.file_type) {
      case 'image':
        return (
          <ImageViewer
            src={file.path}
            alt={file.filename}
            onClose={onClose}
            onPrev={handlePrev}
            onNext={handleNext}
            hasPrev={hasPrev}
            hasNext={hasNext}
          />
        );

      case 'video':
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
            <div className="relative w-full max-w-4xl">
              <Button
                variant="ghost"
                className="absolute top-4 right-4 bg-black/50"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
              <VideoPlayer src={file.path} poster={file.thumbnail_path} className="w-full" />
            </div>
          </div>
        );

      case 'document':
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90">
            <div className="relative w-full max-w-4xl bg-background rounded-lg p-6">
              <Button
                variant="ghost"
                className="absolute top-4 right-4"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
              <DocPreview
                filePath={file.path}
                fileType={file.extension}
                className="h-[80vh]"
              />
            </div>
          </div>
        );

      default:
        return (
          <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/90">
            <Button
              variant="ghost"
              className="absolute top-4 right-4 bg-black/50"
              onClick={onClose}
            >
              <X className="h-4 w-4" />
            </Button>
            <div className="text-6xl mb-4">📄</div>
            <p className="text-lg font-medium">{file.filename}</p>
            <p className="text-sm text-muted-foreground">
              此文件类型不支持预览
            </p>
          </div>
        );
    }
  };

  return renderPreview();
}

export default FilePreviewDialog;