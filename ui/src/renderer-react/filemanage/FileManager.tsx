/**
 * 文件管理 - 主容器组件
 */

import * as React from 'react';
import {
  FolderOpen,
  Scan,
  Image,
  Lock,
  Clock,
  Film,
  Music,
  Sparkles,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ScanView } from './ScanView';
import { GalleryView } from './GalleryView';
import { VaultView } from './VaultView';
import { TimelineView } from './TimelineView';
import { MediaStudio } from './MediaStudio';
import { SmartAlbumView } from './SmartAlbumView';

type TabId = 'scan' | 'gallery' | 'albums' | 'vault' | 'timeline' | 'studio';

interface Tab {
  id: TabId;
  label: string;
  icon: React.ElementType;
}

const tabs: Tab[] = [
  { id: 'scan', label: '扫描', icon: Scan },
  { id: 'gallery', label: '画廊', icon: Image },
  { id: 'albums', label: '智能相册', icon: Sparkles },
  { id: 'vault', label: '保险箱', icon: Lock },
  { id: 'timeline', label: '时间线', icon: Clock },
  { id: 'studio', label: '媒体工作室', icon: Film },
];

interface FileManagerProps {
  className?: string;
}

export function FileManager({ className }: FileManagerProps) {
  const [activeTab, setActiveTab] = React.useState<TabId>('scan');
  const [stats, setStats] = React.useState({
    totalFiles: 0,
    organizedFiles: 0,
    encryptedFiles: 0,
  });

  // 获取统计信息
  React.useEffect(() => {
    const loadStats = async () => {
      try {
        const result = await window.fileManager?.getStats();
        if (result) {
          setStats({
            totalFiles: result.totalFiles,
            organizedFiles: result.organizedFiles,
            encryptedFiles: result.encryptedFiles,
          });
        }
      } catch (err) {
        console.error('Failed to load stats:', err);
      }
    };
    loadStats();
  }, []);

  const renderContent = () => {
    switch (activeTab) {
      case 'scan':
        return <ScanView onScanComplete={() => {
          // 刷新统计
          window.fileManager?.getStats().then(result => {
            if (result) {
              setStats({
                totalFiles: result.totalFiles,
                organizedFiles: result.organizedFiles,
                encryptedFiles: result.encryptedFiles,
              });
            }
          });
        }} />;
      case 'gallery':
        return <GalleryView />;
      case 'albums':
        return <SmartAlbumView />;
      case 'vault':
        return <VaultView />;
      case 'timeline':
        return <TimelineView />;
      case 'studio':
        return <MediaStudio />;
      default:
        return null;
    }
  };

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* 标签页导航 */}
      <div className="flex items-center justify-between border-b border-border/40 px-4 py-2">
        <div className="flex items-center gap-1">
          {tabs.map((tab) => (
            <Button
              key={tab.id}
              variant={activeTab === tab.id ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setActiveTab(tab.id)}
              className="gap-2"
            >
              <tab.icon className="h-4 w-4" />
              {tab.label}
            </Button>
          ))}
        </div>

        {/* 统计信息 */}
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span>已扫描 {stats.totalFiles} 文件</span>
          <span>已整理 {stats.organizedFiles} 文件</span>
          <span>加密 {stats.encryptedFiles} 文件</span>
        </div>
      </div>

      {/* 主内容区域 */}
      <div className="flex-1 overflow-hidden">
        {renderContent()}
      </div>
    </div>
  );
}

export default FileManager;