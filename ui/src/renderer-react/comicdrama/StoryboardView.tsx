/**
 * 漫剧 - 分镜 + 美术生成
 */

import * as React from 'react';
import { ChevronDown, ChevronUp, ImageIcon, Loader2, Plus, RefreshCw, RotateCcw, Sliders, Trash2, Users, Wand2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { mediaUrl } from '@/filemanage/lib/mediaUrl';
import { RecipePanel } from './RecipePanel';
import type { CdProject, CdShot, ComfyModels } from './ipc/types';

const CAMERAS: { v: CdShot['camera']; label: string }[] = [
  { v: 'in', label: '推近' },
  { v: 'out', label: '拉远' },
  { v: 'left', label: '左移' },
  { v: 'right', label: '右移' },
];

export function StoryboardView({ projectId }: { projectId: number }) {
  const [project, setProject] = React.useState<CdProject | null>(null);
  const [generatingAll, setGeneratingAll] = React.useState(false);
  const [progress, setProgress] = React.useState<{ idx: number; total: number } | null>(null);
  const [shotPercent, setShotPercent] = React.useState<Record<number, number>>({});
  const [busyShots, setBusyShots] = React.useState<Set<number>>(new Set());
  const [showChars, setShowChars] = React.useState(false);
  const [regenning, setRegenning] = React.useState(false);
  const [recipeShot, setRecipeShot] = React.useState<CdShot | null>(null);
  const [models, setModels] = React.useState<ComfyModels | null>(null);

  React.useEffect(() => {
    if (!showChars || models) return;
    let cancelled = false;
    window.comicDrama?.listModels()
      .then((m) => { if (!cancelled && m && !m.error) setModels(m); })
      .catch(() => { /* 忽略模型清单加载失败 */ });
    return () => { cancelled = true; };
  }, [showChars, models]);

  React.useEffect(() => {
    let cancelled = false;
    window.comicDrama?.getProject(projectId)
      .then((p) => {
        if (cancelled || !p || 'error' in p) return; // 项目已切换或返回错误则丢弃
        setProject(p);
        if (p.status === 'arting') setGeneratingAll(true); // 刷新后恢复"生成中"态
      })
      .catch(() => { /* 忽略加载失败 */ });
    return () => { cancelled = true; };
  }, [projectId]);

  React.useEffect(() => {
    const api = window.comicDrama;
    if (!api) return;
    const offProg = api.onArtProgress((d) => {
      if (d.projectId !== projectId) return;
      setProgress({ idx: d.idx, total: d.total });
      setShotPercent((prev) => ({ ...prev, [d.shotId]: d.percent }));
    });
    const offShot = api.onShotUpdated((d) => {
      if (d.projectId !== projectId) return;
      setProject((p) => p ? { ...p, shots: p.shots?.map((s) => s.id === d.shotId ? { ...s, status: d.status, image_path: d.imagePath ?? s.image_path, error: d.error } : s) } : p);
      setBusyShots((prev) => { const n = new Set(prev); n.delete(d.shotId); return n; });
      setShotPercent((prev) => { const n = { ...prev }; delete n[d.shotId]; return n; });
    });
    const offDone = api.onArtDone((d) => {
      if (d.projectId !== projectId) return;
      setGeneratingAll(false);
      setProgress(null);
      setShotPercent({});
      if (d.error) alert(d.error);
    });
    return () => { offProg(); offShot(); offDone(); };
  }, [projectId]);

  if (!project) return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;
  const shots = project.shots || [];
  const characters = project.characters || [];
  const hasFailed = shots.some((s) => s.status === 'error');
  const doneCount = shots.filter((s) => s.status === 'done').length;

  const startArt = async (only?: 'failed' | 'pending') => {
    setGeneratingAll(true);
    const r = await window.comicDrama!.generateArt(projectId, only);
    if (r.error) { setGeneratingAll(false); alert(r.error); }
  };

  const cancelAll = async () => {
    await window.comicDrama!.cancelArt(projectId);
    setGeneratingAll(false);
    setProgress(null);
    setShotPercent({});
  };

  const regenShot = async (shot: CdShot) => {
    setBusyShots((prev) => new Set(prev).add(shot.id));
    setShotPercent((prev) => ({ ...prev, [shot.id]: -1 }));
    const r = await window.comicDrama!.generateShot(shot.id);
    if ('error' in r && r.error) {
      alert(r.error);
      setBusyShots((prev) => { const n = new Set(prev); n.delete(shot.id); return n; });
      setShotPercent((prev) => { const n = { ...prev }; delete n[shot.id]; return n; });
    }
  };

  const patchShot = (shotId: number, fields: Partial<CdShot>) => {
    setProject((p) => p ? { ...p, shots: p.shots?.map((s) => s.id === shotId ? { ...s, ...fields } : s) } : p);
  };
  const saveShot = (shotId: number, fields: Partial<CdShot>) => {
    window.comicDrama!.updateShot(shotId, fields as never);
  };

  const addShot = async () => {
    const p = await window.comicDrama!.addShot(projectId, {});
    if (!('error' in p)) setProject(p);
  };
  const deleteShot = async (shotId: number) => {
    if (!confirm('删除该分镜?')) return;
    const p = await window.comicDrama!.deleteShot(shotId);
    if (!('error' in p)) setProject(p);
  };
  const move = async (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= shots.length) return;
    const ids = shots.map((s) => s.id);
    [ids[index], ids[target]] = [ids[target], ids[index]];
    const p = await window.comicDrama!.reorderShots(projectId, ids);
    if (!('error' in p)) setProject(p);
  };

  const addCharacter = async () => {
    const p = await window.comicDrama!.addCharacter(projectId, {});
    if (!('error' in p)) setProject(p);
  };
  const deleteCharacter = async (characterId: number) => {
    const p = await window.comicDrama!.deleteCharacter(characterId);
    if (!('error' in p)) setProject(p);
  };
  type CharFields = Partial<{ name: string; appearance_prompt: string; ref_image_path: string; lora_name: string; lora_strength: number; ipadapter_weight: number }>;
  const patchCharacter = (characterId: number, fields: CharFields) => {
    setProject((p) => p ? { ...p, characters: p.characters?.map((c) => c.id === characterId ? { ...c, ...fields } : c) } : p);
  };
  const saveCharacter = (characterId: number, fields: CharFields) => {
    window.comicDrama!.updateCharacter(characterId, fields as never);
  };
  const pickCharRef = async (characterId: number) => {
    const r = await window.comicDrama!.pickAsset(projectId, 'ref');
    if (r.canceled || r.error || !r.path) { if (r.error) alert(r.error); return; }
    patchCharacter(characterId, { ref_image_path: r.path });
    saveCharacter(characterId, { ref_image_path: r.path });
  };

  const regenerateScript = async () => {
    if (!confirm('重新生成剧本会替换现有的全部角色与分镜(已生成的画面将被清除关联), 确定?')) return;
    setRegenning(true);
    const p = await window.comicDrama!.regenerateScript({ projectId });
    setRegenning(false);
    if ('error' in p && p.error) alert(p.error);
    else if (!('error' in p)) setProject(p);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border/40 px-5 py-3">
        <div className="flex-1">
          <p className="text-sm text-muted-foreground line-clamp-1">{project.synopsis}</p>
          {characters.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              角色: {characters.map((c) => c.name).join('、')} · 已完成 {doneCount}/{shots.length}
            </p>
          )}
        </div>
        <Button variant={showChars ? 'secondary' : 'outline'} onClick={() => setShowChars((v) => !v)}>
          <Users className="h-4 w-4" />角色
        </Button>
        <Button variant="outline" onClick={regenerateScript} disabled={regenning || generatingAll}>
          {regenning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}重生成剧本
        </Button>
        {generatingAll ? (
          <Button variant="outline" onClick={cancelAll}><XCircle className="h-4 w-4" />取消</Button>
        ) : (
          <>
            {hasFailed && (
              <Button variant="outline" onClick={() => startArt('failed')}>
                <RotateCcw className="h-4 w-4" />重试失败
              </Button>
            )}
            <Button variant="outline" onClick={() => startArt('pending')}>
              <Wand2 className="h-4 w-4" />生成未完成
            </Button>
            <Button onClick={() => startArt()}><Wand2 className="h-4 w-4" />生成全部</Button>
          </>
        )}
      </div>

      {showChars && (
        <div className="border-b border-border/40 bg-muted/20 px-5 py-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">角色(外观提示词用于稳定跨镜形象)</span>
            <Button size="sm" variant="outline" className="h-7" onClick={addCharacter}><Plus className="h-3.5 w-3.5" />新增角色</Button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {characters.map((c) => (
              <div key={c.id} className="flex items-start gap-2 rounded-lg border border-border/50 bg-background p-2">
                <button
                  type="button"
                  onClick={() => pickCharRef(c.id)}
                  title={c.ref_image_path ? '点击更换参考图' : '点击选择参考图(IPAdapter 人脸/风格一致性)'}
                  className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md border border-border/50 bg-muted/40 hover:border-primary"
                >
                  {c.ref_image_path
                    ? <img src={mediaUrl(c.ref_image_path)} alt="ref" className="h-full w-full object-cover" />
                    : <ImageIcon className="h-5 w-5 text-muted-foreground" />}
                </button>
                <div className="flex-1 space-y-1">
                  <Input className="h-7 text-xs" value={c.name ?? ''}
                    onChange={(e) => patchCharacter(c.id, { name: e.target.value })}
                    onBlur={(e) => saveCharacter(c.id, { name: e.target.value })}
                    placeholder="角色名" />
                  <Textarea rows={2} className="text-xs" value={c.appearance_prompt ?? ''}
                    onChange={(e) => patchCharacter(c.id, { appearance_prompt: e.target.value })}
                    onBlur={(e) => saveCharacter(c.id, { appearance_prompt: e.target.value })}
                    placeholder="外观(英文关键词: 发色/发型/瞳色/服装/年龄气质)" />
                  <div className="flex items-center gap-1">
                    <select
                      className="h-7 flex-1 rounded-md border border-border/50 bg-background px-1 text-xs"
                      value={c.lora_name ?? ''}
                      onChange={(e) => { const v = e.target.value || undefined; patchCharacter(c.id, { lora_name: v }); saveCharacter(c.id, { lora_name: v as never }); }}
                    >
                      <option value="">无角色 LoRA</option>
                      {(models?.loras ?? []).map((l) => <option key={l} value={l}>{l}</option>)}
                    </select>
                    <Input type="number" step={0.05} min={0} max={2} className="h-7 w-16 text-xs" title="LoRA 强度"
                      value={c.lora_strength ?? ''} placeholder="Lora"
                      onChange={(e) => patchCharacter(c.id, { lora_strength: e.target.value === '' ? undefined : Number(e.target.value) })}
                      onBlur={(e) => saveCharacter(c.id, { lora_strength: e.target.value === '' ? undefined : Number(e.target.value) })} />
                    <Input type="number" step={0.05} min={0} max={1} className="h-7 w-16 text-xs" title="IPAdapter 权重(参考图)"
                      value={c.ipadapter_weight ?? ''} placeholder="IPA"
                      onChange={(e) => patchCharacter(c.id, { ipadapter_weight: e.target.value === '' ? undefined : Number(e.target.value) })}
                      onBlur={(e) => saveCharacter(c.id, { ipadapter_weight: e.target.value === '' ? undefined : Number(e.target.value) })} />
                  </div>
                </div>
                <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600" onClick={() => deleteCharacter(c.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {characters.length === 0 && <p className="text-xs text-muted-foreground">暂无角色, 点击「新增角色」。</p>}
          </div>
        </div>
      )}

      {progress && (
        <div className="px-5 pt-3">
          <Progress value={progress.total ? (progress.idx / progress.total) * 100 : 0} />
          <p className="mt-1 text-xs text-muted-foreground">生成中 第 {progress.idx + 1}/{progress.total} 张…</p>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="grid grid-cols-1 gap-4 p-5 md:grid-cols-2 xl:grid-cols-3">
          {shots.map((shot, index) => {
            const busy = busyShots.has(shot.id);
            const pct = shotPercent[shot.id];
            const showOverlay = pct != null;
            return (
              <div key={shot.id} className="rounded-xl border border-border/50 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground">镜 {shot.idx + 1}</span>
                  <div className="flex items-center gap-0.5">
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(index, -1)} disabled={index === 0 || generatingAll}>
                      <ChevronUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => move(index, 1)} disabled={index === shots.length - 1 || generatingAll}>
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => regenShot(shot)} disabled={busy || generatingAll}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" className={`h-7 w-7 p-0 ${shot.recipe_json ? 'text-primary' : ''}`} onClick={() => setRecipeShot(shot)} title="配方(img2img/参考图/姿态/放大)">
                      <Sliders className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-500 hover:text-red-600" onClick={() => deleteShot(shot.id)} disabled={generatingAll}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                <div className={`relative mb-2 flex items-center justify-center overflow-hidden rounded-lg bg-muted ${project.aspect_ratio === '16:9' ? 'aspect-video' : 'aspect-[9/16]'}`}>
                  {shot.image_path ? (
                    <img src={mediaUrl(shot.image_path)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-muted-foreground">
                      {showOverlay ? <Loader2 className="h-6 w-6 animate-spin" /> : <ImageIcon className="h-6 w-6" />}
                      <span className="text-xs">{shot.status === 'error' ? '生成失败' : '未生成'}</span>
                    </div>
                  )}
                  {showOverlay && (
                    <div className="absolute inset-x-0 bottom-0 bg-black/50 px-2 py-1">
                      {pct >= 0 ? (
                        <>
                          <Progress value={pct} className="h-1.5" />
                          <span className="mt-0.5 block text-center text-[10px] text-white/90">{pct}%</span>
                        </>
                      ) : (
                        <span className="block text-center text-[10px] text-white/90">排队/加载中…</span>
                      )}
                    </div>
                  )}
                </div>

                {shot.error && <p className="mb-1 text-[11px] text-red-500 line-clamp-2">{shot.error}</p>}

                <Input className="mb-1.5 text-xs" value={shot.scene_desc ?? ''}
                  onChange={(e) => patchShot(shot.id, { scene_desc: e.target.value })}
                  onBlur={(e) => saveShot(shot.id, { scene_desc: e.target.value })}
                  placeholder="场景描述(中文, 给人看)" />
                <Textarea rows={2} className="mb-2 text-xs" value={shot.image_prompt ?? ''}
                  onChange={(e) => patchShot(shot.id, { image_prompt: e.target.value })}
                  onBlur={(e) => saveShot(shot.id, { image_prompt: e.target.value })}
                  placeholder="画面提示词(英文)" />
                <Input className="mb-2 text-xs" value={shot.subtitle ?? ''}
                  onChange={(e) => patchShot(shot.id, { subtitle: e.target.value })}
                  onBlur={(e) => saveShot(shot.id, { subtitle: e.target.value })}
                  placeholder="字幕/台词" />

                <div className="mb-2 flex items-center gap-2">
                  <select className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    value={shot.character_id ?? ''}
                    onChange={(e) => {
                      const cid = e.target.value ? Number(e.target.value) : null;
                      patchShot(shot.id, { character_id: cid });
                      saveShot(shot.id, { character_id: cid });
                    }}>
                    <option value="">无角色</option>
                    {characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div className="flex items-center gap-2">
                  <select className="h-8 flex-1 rounded-md border border-input bg-background px-2 text-xs"
                    value={shot.camera}
                    onChange={(e) => { patchShot(shot.id, { camera: e.target.value as CdShot['camera'] }); saveShot(shot.id, { camera: e.target.value as CdShot['camera'] }); }}>
                    {CAMERAS.map((c) => <option key={c.v} value={c.v}>{c.label}</option>)}
                  </select>
                  <Input type="number" className="h-8 w-20 text-xs" value={shot.duration_ms}
                    onChange={(e) => patchShot(shot.id, { duration_ms: Number(e.target.value) })}
                    onBlur={(e) => saveShot(shot.id, { duration_ms: Number(e.target.value) })} />
                  <span className="text-[11px] text-muted-foreground">ms</span>
                </div>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addShot}
            disabled={generatingAll}
            className={`flex min-h-[220px] items-center justify-center rounded-xl border border-dashed border-border/60 text-muted-foreground transition-colors hover:bg-muted/40 ${project.aspect_ratio === '16:9' ? '' : ''}`}
          >
            <span className="flex flex-col items-center gap-1 text-sm"><Plus className="h-6 w-6" />新增分镜</span>
          </button>
        </div>
      </ScrollArea>

      {recipeShot && (
        <RecipePanel
          projectId={projectId}
          shot={recipeShot}
          onClose={() => setRecipeShot(null)}
          onSaved={(shotId, recipeJson) => patchShot(shotId, { recipe_json: recipeJson ?? undefined })}
        />
      )}
    </div>
  );
}

export default StoryboardView;
