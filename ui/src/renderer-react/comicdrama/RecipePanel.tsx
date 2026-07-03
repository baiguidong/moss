/**
 * 漫剧 - 单镜配方(Recipe)编辑抽屉
 * 编辑 cd_shots.recipe_json: text2img/img2img、参考图(IPAdapter)、姿态图(ControlNet)、放大与局部覆盖。
 * 参考图/姿态图存本地绝对路径, 生成时由主进程上传到 ComfyUI。
 */

import * as React from 'react';
import { ImagePlus, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { mediaUrl } from '@/filemanage/lib/mediaUrl';
import type { CdShot, ComfyModels, Recipe } from './ipc/types';

function parseRecipe(json?: string): Recipe {
  if (!json) return {};
  try { return JSON.parse(json) as Recipe; } catch { return {}; }
}

/** 去掉空字段, 返回可存的 recipe(全空则返回 null 以清除) */
function cleanRecipe(r: Recipe): Recipe | null {
  const out: Recipe = {};
  if (r.mode === 'img2img' && r.init?.image) out.init = { image: r.init.image, denoise: r.init.denoise ?? 0.6 };
  if (r.mode) out.mode = r.mode;
  if (r.ipadapter?.image) out.ipadapter = { image: r.ipadapter.image, weight: r.ipadapter.weight ?? 0.8, preset: r.ipadapter.preset };
  if (r.controlnets?.length && r.controlnets[0]?.image && r.controlnets[0]?.model) out.controlnets = r.controlnets;
  if (r.upscale?.model) out.upscale = r.upscale;
  if (r.checkpoint) out.checkpoint = r.checkpoint;
  if (Number.isFinite(r.steps)) out.steps = r.steps;
  if (Number.isFinite(r.cfg)) out.cfg = r.cfg;
  if (Number.isFinite(r.seed)) out.seed = r.seed;
  return Object.keys(out).length ? out : null;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}

function ImagePick({ label, value, onPick, onClear }: {
  label: string; value?: string; onPick: () => void; onClear: () => void;
}) {
  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-md border border-border/60 bg-muted">
          {value ? <img src={mediaUrl(value)} alt="" className="h-full w-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={onPick}>选择</Button>
        {value && <Button size="sm" variant="ghost" className="h-8 text-red-500" onClick={onClear}>清除</Button>}
      </div>
    </Field>
  );
}

export function RecipePanel({ projectId, shot, onClose, onSaved }: {
  projectId: number; shot: CdShot; onClose: () => void; onSaved: (shotId: number, recipeJson: string | null) => void;
}) {
  const [recipe, setRecipe] = React.useState<Recipe>(() => parseRecipe(shot.recipe_json));
  const [models, setModels] = React.useState<ComfyModels | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    window.comicDrama?.listModels().then((m) => {
      if (!cancelled && !('error' in m)) setModels(m);
    });
    return () => { cancelled = true; };
  }, []);

  const set = (patch: Partial<Recipe>) => setRecipe((r) => ({ ...r, ...patch }));

  const pick = async (kind: 'ref' | 'pose', apply: (path: string) => void) => {
    const r = await window.comicDrama!.pickAsset(projectId, kind);
    if (r.path) apply(r.path);
  };

  const cn = recipe.controlnets?.[0];
  const setCn = (patch: Partial<NonNullable<Recipe['controlnets']>[number]>) =>
    setRecipe((r) => ({ ...r, controlnets: [{ model: '', image: '', strength: 1, ...(r.controlnets?.[0] || {}), ...patch }] }));

  const save = async () => {
    setSaving(true);
    const cleaned = cleanRecipe(recipe);
    const json = cleaned ? JSON.stringify(cleaned) : null;
    await window.comicDrama!.updateShot(shot.id, { recipe_json: json } as never);
    setSaving(false);
    onSaved(shot.id, json);
    onClose();
  };

  const controlnets = models?.controlnets ?? [];
  const upscalers = models?.upscalers ?? [];
  const checkpoints = models?.checkpoints ?? [];
  const ipReady = models?.nodesPresent?.ipadapter;
  const cnReady = controlnets.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div className="flex h-full w-full max-w-md flex-col bg-background shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/40 px-4 py-3">
          <span className="text-sm font-semibold">镜 {shot.idx + 1} · 配方</span>
          <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={onClose}><X className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          <Field label="生成模式">
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={recipe.mode ?? 'text2img'}
              onChange={(e) => set({ mode: e.target.value as Recipe['mode'] })}>
              <option value="text2img">文生图(text2img)</option>
              <option value="img2img">图生图(img2img, 需参考底图)</option>
            </select>
          </Field>

          {recipe.mode === 'img2img' && (
            <>
              <ImagePick label="底图(img2img 起点)" value={recipe.init?.image}
                onPick={() => pick('ref', (p) => set({ init: { image: p, denoise: recipe.init?.denoise ?? 0.6 } }))}
                onClear={() => set({ init: undefined })} />
              <Field label={`重绘强度 denoise = ${recipe.init?.denoise ?? 0.6}(小=更像底图)`}>
                <input type="range" min={0.2} max={1} step={0.05} className="w-full"
                  value={recipe.init?.denoise ?? 0.6}
                  onChange={(e) => set({ init: { image: recipe.init?.image || '', denoise: Number(e.target.value) } })} />
              </Field>
            </>
          )}

          <div className="rounded-lg border border-border/50 p-3">
            <p className="mb-2 text-xs font-semibold">人脸/风格一致性 · IPAdapter {!ipReady && <span className="text-amber-500">(未安装节点)</span>}</p>
            <ImagePick label="参考图(锁定长相/画风)" value={recipe.ipadapter?.image}
              onPick={() => pick('ref', (p) => set({ ipadapter: { image: p, weight: recipe.ipadapter?.weight ?? 0.8 } }))}
              onClear={() => set({ ipadapter: undefined })} />
            {recipe.ipadapter?.image && (
              <Field label={`权重 = ${recipe.ipadapter?.weight ?? 0.8}`}>
                <input type="range" min={0.1} max={1.2} step={0.05} className="w-full"
                  value={recipe.ipadapter?.weight ?? 0.8}
                  onChange={(e) => set({ ipadapter: { image: recipe.ipadapter!.image, weight: Number(e.target.value) } })} />
              </Field>
            )}
          </div>

          <div className="rounded-lg border border-border/50 p-3">
            <p className="mb-2 text-xs font-semibold">姿态控制 · ControlNet {!cnReady && <span className="text-amber-500">(无 controlnet 模型)</span>}</p>
            <ImagePick label="姿态/骨架图" value={cn?.image}
              onPick={() => pick('pose', (p) => setCn({ image: p }))}
              onClear={() => setRecipe((r) => ({ ...r, controlnets: undefined }))} />
            {cn?.image && (
              <Field label="ControlNet 模型">
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={cn.model} onChange={(e) => setCn({ model: e.target.value })}>
                  <option value="">选择模型…</option>
                  {controlnets.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
            )}
          </div>

          <Field label="放大模型(可选)">
            <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
              value={recipe.upscale?.model ?? ''}
              onChange={(e) => set({ upscale: e.target.value ? { model: e.target.value } : undefined })}>
              <option value="">不放大</option>
              {upscalers.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </Field>

          <div className="rounded-lg border border-border/50 p-3">
            <p className="mb-2 text-xs font-semibold">局部覆盖(留空用全局配置)</p>
            <div className="space-y-3">
              <Field label="Checkpoint">
                <select className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={recipe.checkpoint ?? ''} onChange={(e) => set({ checkpoint: e.target.value || undefined })}>
                  <option value="">(全局默认)</option>
                  {checkpoints.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="步数">
                  <Input type="number" className="h-8 text-xs" value={recipe.steps ?? ''}
                    onChange={(e) => set({ steps: e.target.value ? Number(e.target.value) : undefined })} />
                </Field>
                <Field label="CFG">
                  <Input type="number" className="h-8 text-xs" value={recipe.cfg ?? ''}
                    onChange={(e) => set({ cfg: e.target.value ? Number(e.target.value) : undefined })} />
                </Field>
                <Field label="固定 seed">
                  <Input type="number" className="h-8 text-xs" value={recipe.seed ?? ''}
                    onChange={(e) => set({ seed: e.target.value ? Number(e.target.value) : undefined })} />
                </Field>
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 border-t border-border/40 px-4 py-3">
          <Button onClick={save} disabled={saving} className="flex-1">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}保存配方
          </Button>
          <Button variant="outline" onClick={onClose}>取消</Button>
        </div>
      </div>
    </div>
  );
}

export default RecipePanel;
