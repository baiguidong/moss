/**
 * 漫剧 - 主容器组件
 */

import * as React from 'react';
import { ArrowLeft, Clapperboard, Film, Images, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ProjectList } from './ProjectList';
import { StoryboardView } from './StoryboardView';
import { ComposeView } from './ComposeView';
import { SettingsPanel } from './SettingsPanel';
import './ipc/comicDrama.ipc';

type TopTab = 'list' | 'settings';
type EditorTab = 'shots' | 'compose';

export interface ComicDramaProps {
  className?: string;
}

export function ComicDrama({ className }: ComicDramaProps) {
  const [topTab, setTopTab] = React.useState<TopTab>('list');
  const [activeProjectId, setActiveProjectId] = React.useState<number | null>(null);
  const [editorTab, setEditorTab] = React.useState<EditorTab>('shots');

  const openProject = (id: number) => { setActiveProjectId(id); setEditorTab('shots'); };
  const backToList = () => setActiveProjectId(null);

  // 项目编辑器
  if (activeProjectId != null) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <div className="flex items-center gap-1 border-b border-border/40 px-4 py-2">
          <Button variant="ghost" size="sm" onClick={backToList} className="gap-2">
            <ArrowLeft className="h-4 w-4" /> 返回
          </Button>
          <div className="mx-2 h-4 w-px bg-border" />
          <Button variant={editorTab === 'shots' ? 'secondary' : 'ghost'} size="sm" className="gap-2" onClick={() => setEditorTab('shots')}>
            <Images className="h-4 w-4" /> 分镜 / 美术
          </Button>
          <Button variant={editorTab === 'compose' ? 'secondary' : 'ghost'} size="sm" className="gap-2" onClick={() => setEditorTab('compose')}>
            <Film className="h-4 w-4" /> 合成成片
          </Button>
        </div>
        <div className="flex-1 overflow-hidden">
          {editorTab === 'shots'
            ? <StoryboardView projectId={activeProjectId} />
            : <ComposeView projectId={activeProjectId} />}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex h-full flex-col', className)}>
      <div className="flex items-center gap-1 border-b border-border/40 px-4 py-2">
        <Button variant={topTab === 'list' ? 'secondary' : 'ghost'} size="sm" className="gap-2" onClick={() => setTopTab('list')}>
          <Clapperboard className="h-4 w-4" /> 项目
        </Button>
        <Button variant={topTab === 'settings' ? 'secondary' : 'ghost'} size="sm" className="gap-2" onClick={() => setTopTab('settings')}>
          <Settings className="h-4 w-4" /> ComfyUI 设置
        </Button>
      </div>
      <div className="flex-1 overflow-hidden">
        {topTab === 'list' ? <ProjectList onOpen={openProject} /> : <SettingsPanel />}
      </div>
    </div>
  );
}

export default ComicDrama;
