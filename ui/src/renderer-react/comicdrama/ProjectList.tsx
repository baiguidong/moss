/**
 * 漫剧 - 项目列表 + 新建(生成剧情)
 */

import * as React from 'react';
import { Clapperboard, Loader2, Sparkles, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ScrollArea } from '@/components/ui/scroll-area';
import type { AspectRatio, CdProject } from './ipc/types';

const STATUS_LABEL: Record<string, string> = {
  draft: '草稿',
  scripted: '已出剧本',
  arting: '生成美术中',
  composed: '已合成',
};

export function ProjectList({ onOpen }: { onOpen: (projectId: number) => void }) {
  const [projects, setProjects] = React.useState<CdProject[]>([]);
  const [logline, setLogline] = React.useState('');
  const [style, setStyle] = React.useState('anime style, cinematic lighting, highly detailed');
  const [aspect, setAspect] = React.useState<AspectRatio>('9:16');
  const [shotCount, setShotCount] = React.useState(10);
  const [generating, setGenerating] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(() => {
    window.comicDrama?.listProjects().then(setProjects);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  const generate = async () => {
    if (!logline.trim()) { setError('请先填写题材/梗概'); return; }
    setGenerating(true);
    setError('');
    const res = await window.comicDrama!.generateScript({ logline: logline.trim(), style, aspect, shotCount });
    setGenerating(false);
    if ('error' in res && res.error) { setError(res.error); return; }
    if (typeof res.id !== 'number') { setError('生成失败：未返回有效的项目'); return; }
    setLogline('');
    load();
    onOpen(res.id);
  };

  const remove = async (id: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm('确定删除该项目及其生成物?')) return;
    await window.comicDrama!.deleteProject(id);
    load();
  };

  return (
    <div className="flex h-full">
      {/* 新建面板 */}
      <div className="w-[380px] shrink-0 space-y-3 border-r border-border/40 p-5">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4" /> 新建一集漫剧
        </h3>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">题材 / 梗概</label>
          <Textarea rows={4} value={logline} onChange={(e) => setLogline(e.target.value)}
            placeholder="例: 都市废柴青年意外觉醒读心异能, 却发现暗恋对象心里全是他的糗事…" />
        </div>
        <div>
          <label className="mb-1 block text-xs text-muted-foreground">画风(英文关键词, 会统一追加到每个画面)</label>
          <Input value={style} onChange={(e) => setStyle(e.target.value)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">画幅</label>
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={aspect} onChange={(e) => setAspect(e.target.value as AspectRatio)}>
              <option value="9:16">竖屏 9:16</option>
              <option value="16:9">横屏 16:9</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">分镜数</label>
            <Input type="number" min={4} max={20} value={shotCount}
              onChange={(e) => setShotCount(Number(e.target.value))} />
          </div>
        </div>
        <Button className="w-full" onClick={generate} disabled={generating}>
          {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {generating ? '生成剧情中…' : '生成剧情与分镜'}
        </Button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>

      {/* 项目列表 */}
      <ScrollArea className="flex-1">
        <div className="grid grid-cols-2 gap-3 p-5 lg:grid-cols-3">
          {projects.length === 0 && (
            <div className="col-span-full py-16 text-center text-sm text-muted-foreground">还没有项目, 从左侧新建一集吧</div>
          )}
          {projects.map((p) => (
            <div key={p.id} onClick={() => onOpen(p.id)}
              className="group cursor-pointer rounded-xl border border-border/50 p-4 transition hover:border-primary/50 hover:bg-accent/40">
              <div className="mb-2 flex items-start justify-between">
                <Clapperboard className="h-5 w-5 text-primary" />
                <button onClick={(e) => remove(p.id, e)}
                  className="opacity-0 transition group-hover:opacity-100">
                  <Trash2 className="h-4 w-4 text-muted-foreground hover:text-red-500" />
                </button>
              </div>
              <div className="truncate font-medium">{p.title}</div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{p.synopsis || p.logline}</div>
              <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded bg-secondary px-1.5 py-0.5">{p.aspect_ratio}</span>
                <span>{STATUS_LABEL[p.status] || p.status}</span>
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

export default ProjectList;
