/**
 * 漫剧 - 合成成片
 */

import * as React from 'react';
import { Film, Loader2, Music, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { mediaUrl } from '@/filemanage/lib/mediaUrl';
import type { CdProject, ComposeOptions } from './ipc/types';

const DEFAULT_OPTIONS: Required<Pick<ComposeOptions, 'fps' | 'crf' | 'bgmVolume'>> & {
  short: number;
  subFontScale: number;
  subColor: string;
  subPosition: 'bottom' | 'top' | 'center';
  boxOpacity: number;
} = {
  fps: 30,
  crf: 20,
  bgmVolume: 1,
  short: 720,
  subFontScale: 0,     // 0 = 自动(按分辨率)
  subColor: 'white',
  subPosition: 'bottom',
  boxOpacity: 0.5,
};

export function ComposeView({ projectId }: { projectId: number }) {
  const [project, setProject] = React.useState<CdProject | null>(null);
  const [composing, setComposing] = React.useState(false);
  const [percent, setPercent] = React.useState(0);
  const [error, setError] = React.useState('');
  const [outputVer, setOutputVer] = React.useState(0); // 强制刷新 <video>
  const [opts, setOpts] = React.useState(DEFAULT_OPTIONS);

  // 记录当前激活的 projectId, 丢弃切换项目后才返回的旧请求结果
  const latestProjectId = React.useRef(projectId);
  React.useEffect(() => { latestProjectId.current = projectId; }, [projectId]);

  const reload = React.useCallback(() => {
    const pid = projectId;
    window.comicDrama?.getProject(pid)
      .then((p) => {
        if (latestProjectId.current !== pid) return;
        if (p && !('error' in p)) setProject(p);
      })
      .catch(() => { /* 忽略加载失败 */ });
  }, [projectId]);

  React.useEffect(() => { reload(); }, [reload]);

  React.useEffect(() => {
    const api = window.comicDrama;
    if (!api) return;
    const offP = api.onComposeProgress((d) => { if (d.projectId === projectId) setPercent(d.percent); });
    const offD = api.onComposeDone((d) => {
      if (d.projectId !== projectId) return;
      setComposing(false); setPercent(100); setOutputVer((v) => v + 1); reload();
    });
    const offE = api.onComposeError((d) => {
      if (d.projectId !== projectId) return;
      setComposing(false); setError(d.error);
    });
    return () => { offP(); offD(); offE(); };
  }, [projectId, reload]);

  if (!project) return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;

  const readyCount = (project.shots || []).filter((s) => s.image_path).length;
  const totalCount = (project.shots || []).length;

  const pickBgm = async () => {
    const r = await window.comicDrama!.pickBgm(projectId);
    if (r.path) reload();
  };

  const compose = async () => {
    setComposing(true); setError(''); setPercent(0);
    const composeOptions: ComposeOptions = {
      fps: opts.fps,
      crf: opts.crf,
      bgmVolume: opts.bgmVolume,
      resolution: { short: opts.short },
      subtitle: {
        color: opts.subColor,
        position: opts.subPosition,
        boxOpacity: opts.boxOpacity,
        ...(opts.subFontScale > 0 ? { fontSize: opts.subFontScale } : {}),
      },
    };
    const r = await window.comicDrama!.compose(projectId, composeOptions);
    if (r.error) { setComposing(false); setError(r.error); }
  };

  const setOpt = <K extends keyof typeof opts>(k: K, v: (typeof opts)[K]) => setOpts((o) => ({ ...o, [k]: v }));

  const cancel = async () => {
    await window.comicDrama!.cancelCompose(projectId);
    setComposing(false);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5 p-6">
      <div className="rounded-xl border border-border/50 p-4">
        <div className="mb-3 text-sm">
          已生成画面 <span className="font-semibold">{readyCount}</span> / {totalCount} 个分镜
          {readyCount < totalCount && <span className="ml-2 text-xs text-amber-500">(未生成的分镜将被跳过)</span>}
        </div>

        <div className="mb-3 flex items-center gap-3">
          <Button variant="outline" onClick={pickBgm}><Music className="h-4 w-4" />选择背景音乐</Button>
          <span className="truncate text-xs text-muted-foreground">
            {project.bgm_path ? project.bgm_path.split('/').pop() : '未选择(可不加)'}
          </span>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">帧率 fps</label>
            <Input type="number" className="h-8 text-xs" value={opts.fps} onChange={(e) => setOpt('fps', Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">短边分辨率</label>
            <Input type="number" step={90} className="h-8 text-xs" value={opts.short} onChange={(e) => setOpt('short', Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">画质 CRF(小=清晰)</label>
            <Input type="number" min={0} max={51} className="h-8 text-xs" value={opts.crf} onChange={(e) => setOpt('crf', Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">BGM 音量</label>
            <Input type="number" step={0.1} min={0} className="h-8 text-xs" value={opts.bgmVolume} onChange={(e) => setOpt('bgmVolume', Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">字幕位置</label>
            <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              value={opts.subPosition}
              onChange={(e) => setOpt('subPosition', e.target.value as typeof opts.subPosition)}>
              <option value="bottom">底部</option>
              <option value="center">居中</option>
              <option value="top">顶部</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">字幕颜色</label>
            <select className="h-8 w-full rounded-md border border-input bg-background px-2 text-xs"
              value={opts.subColor}
              onChange={(e) => setOpt('subColor', e.target.value)}>
              <option value="white">白</option>
              <option value="yellow">黄</option>
              <option value="#00e5ff">青</option>
              <option value="black">黑</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">字号(0=自动)</label>
            <Input type="number" min={0} className="h-8 text-xs" value={opts.subFontScale} onChange={(e) => setOpt('subFontScale', Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs text-muted-foreground">字幕底框不透明度</label>
            <Input type="number" step={0.1} min={0} max={1} className="h-8 text-xs" value={opts.boxOpacity} onChange={(e) => setOpt('boxOpacity', Number(e.target.value))} />
          </div>
        </div>

        <div className="flex items-center gap-3">
          {composing ? (
            <Button variant="outline" onClick={cancel}><XCircle className="h-4 w-4" />取消</Button>
          ) : (
            <Button onClick={compose} disabled={readyCount === 0}><Film className="h-4 w-4" />合成成片</Button>
          )}
          {composing && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {composing && (
          <div className="mt-3">
            <Progress value={percent} />
            <p className="mt-1 text-xs text-muted-foreground">合成中 {percent}%…</p>
          </div>
        )}
        {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
      </div>

      {project.output_path && (
        <div className="rounded-xl border border-border/50 p-4">
          <p className="mb-2 text-sm font-medium">成片预览</p>
          <video
            key={outputVer}
            src={`${mediaUrl(project.output_path)}?v=${outputVer}`}
            controls
            className={`w-full rounded-lg bg-black ${project.aspect_ratio === '16:9' ? '' : 'max-h-[70vh]'}`}
          />
          <p className="mt-2 truncate text-xs text-muted-foreground">{project.output_path}</p>
        </div>
      )}
    </div>
  );
}

export default ComposeView;
