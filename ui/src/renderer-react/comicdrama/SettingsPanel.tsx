/**
 * 漫剧 - ComfyUI 配置面板
 */

import * as React from 'react';
import { Loader2, Plug, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { ComfyConfig, ComfyModels } from './ipc/types';

/** 有清单时下拉选择, 无清单时退回手输 */
function ModelSelect({
  label, value, options, placeholder, onChange,
}: {
  label: string; value: string; options: string[]; placeholder?: string; onChange: (v: string) => void;
}) {
  const has = options.length > 0;
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {has ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            'flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm',
            'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          )}
        >
          <option value="">{placeholder || '(自动/默认)'}</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} />
      )}
    </div>
  );
}

export function SettingsPanel() {
  const [cfg, setCfg] = React.useState<ComfyConfig | null>(null);
  const [models, setModels] = React.useState<ComfyModels | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [pinging, setPinging] = React.useState(false);
  const [loadingModels, setLoadingModels] = React.useState(false);
  const [pingMsg, setPingMsg] = React.useState('');
  const [savedMsg, setSavedMsg] = React.useState('');
  const savedMsgTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  React.useEffect(() => () => {
    if (savedMsgTimer.current) clearTimeout(savedMsgTimer.current);
  }, []);

  const loadModels = React.useCallback(async (url?: string) => {
    setLoadingModels(true);
    try {
      const m = await window.comicDrama!.listModels(url);
      setModels(m);
    } finally {
      setLoadingModels(false);
    }
  }, []);

  React.useEffect(() => {
    window.comicDrama?.getComfyConfig().then((c) => {
      setCfg(c);
      loadModels(c.url);
    });
  }, [loadModels]);

  if (!cfg) return <div className="p-6 text-sm text-muted-foreground">加载中…</div>;

  const update = (patch: Partial<ComfyConfig>) => setCfg((c) => (c ? { ...c, ...patch } : c));

  const save = async () => {
    setSaving(true);
    setSavedMsg('');
    const merged = await window.comicDrama!.saveComfyConfig(cfg);
    setCfg(merged);
    setSaving(false);
    setSavedMsg('已保存');
    if (savedMsgTimer.current) clearTimeout(savedMsgTimer.current);
    savedMsgTimer.current = setTimeout(() => setSavedMsg(''), 2000);
  };

  const ping = async () => {
    setPinging(true);
    setPingMsg('');
    const r = await window.comicDrama!.pingComfy(cfg.url);
    setPinging(false);
    setPingMsg(r.ok ? '连接成功 ✓' : `连接失败: ${r.error || r.status}`);
    if (r.ok) loadModels(cfg.url);
  };

  const modelErr = models?.error;
  const sel = (arr?: string[]) => (Array.isArray(arr) ? arr : []);

  return (
    <div className="mx-auto max-w-2xl space-y-5 p-6">
      <div>
        <label className="mb-1 block text-sm font-medium">ComfyUI 地址</label>
        <div className="flex gap-2">
          <Input value={cfg.url} onChange={(e) => update({ url: e.target.value })} placeholder="http://127.0.0.1:8188" />
          <Button variant="outline" onClick={ping} disabled={pinging}>
            {pinging ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plug className="h-4 w-4" />}
            测试
          </Button>
          <Button variant="outline" onClick={() => loadModels(cfg.url)} disabled={loadingModels}>
            {loadingModels ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            刷新模型
          </Button>
        </div>
        {pingMsg && <p className="mt-1 text-xs text-muted-foreground">{pingMsg}</p>}
        {modelErr && <p className="mt-1 text-xs text-amber-500">读取模型失败: {modelErr}(将退回手动输入)</p>}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <ModelSelect
          label="Checkpoint(可空)"
          value={cfg.checkpoint ?? ''}
          options={sel(models?.checkpoints)}
          placeholder="留空自动选第一个"
          onChange={(v) => update({ checkpoint: v })}
        />
        <ModelSelect
          label="VAE(可空)"
          value={cfg.vae ?? ''}
          options={sel(models?.vaes)}
          placeholder="留空用 checkpoint 内置"
          onChange={(v) => update({ vae: v })}
        />
        <ModelSelect
          label="采样器 Sampler"
          value={cfg.sampler ?? 'dpmpp_2m'}
          options={sel(models?.samplers)}
          onChange={(v) => update({ sampler: v })}
        />
        <ModelSelect
          label="调度器 Scheduler"
          value={cfg.scheduler ?? 'karras'}
          options={sel(models?.schedulers)}
          onChange={(v) => update({ scheduler: v })}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="mb-1 block text-sm font-medium">步数</label>
          <Input type="number" value={cfg.steps ?? 20} onChange={(e) => update({ steps: Number(e.target.value) })} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">CFG</label>
          <Input type="number" value={cfg.cfg ?? 7} onChange={(e) => update({ cfg: Number(e.target.value) })} />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">生成短边基准</label>
          <Input type="number" step={64} value={cfg.baseSize ?? 512} onChange={(e) => update({ baseSize: Number(e.target.value) })} />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">负向提示词</label>
        <Textarea rows={2} value={cfg.negativePrompt ?? ''} onChange={(e) => update({ negativePrompt: e.target.value })} />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">自定义 workflow(API 格式 JSON, 可空)</label>
        <p className="mb-1 text-xs text-muted-foreground">
          留空则用内置默认 text2img。自定义时可用占位符: %POSITIVE% %NEGATIVE% %SEED% %WIDTH% %HEIGHT% %STEPS% %CFG% %CKPT% %SAMPLER% %SCHEDULER% %DENOISE%
        </p>
        <Textarea
          rows={6}
          className="font-mono text-xs"
          value={cfg.workflow ?? ''}
          onChange={(e) => update({ workflow: e.target.value })}
          placeholder='{"3": {"class_type": "KSampler", ...}}'
        />
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存
        </Button>
        {savedMsg && <span className="text-sm text-emerald-500">{savedMsg}</span>}
      </div>
    </div>
  );
}

export default SettingsPanel;
