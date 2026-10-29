import * as React from 'react';
import { Check, ChevronDown, Monitor, Moon, RotateCcw, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuRadioGroup, DropdownMenuRadioItem } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { isWebUI } from '@/lib/host-environment';
import { normalizeAppearance } from '../../appearance-settings.mjs';
import { THEME_CATALOG, UI_FONTS, CODE_FONTS } from '../../theme-catalog.mjs';
import { resolveAppearance } from '@/theme/appearance';
import type { AppearanceProfile, DesktopSettings } from '../types';

type Appearance = DesktopSettings['appearance'];
const selectClass = 'h-8 max-w-full rounded-md border border-input bg-background px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring';
function radioKey(event: React.KeyboardEvent<HTMLButtonElement>) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  const buttons = [...event.currentTarget.parentElement!.querySelectorAll<HTMLButtonElement>('[role="radio"]')];
  const index = buttons.indexOf(event.currentTarget);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -1 : 1) + buttons.length) % buttons.length;
  buttons[next].focus(); buttons[next].click();
}
function Row({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 py-3.5"><div className="min-w-0 flex-1"><p className="text-[13px] font-medium">{title}</p>{description && <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>}</div><div className="flex max-w-full shrink-0 items-center justify-end">{children}</div></div>;
}
function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange(value: boolean): void }) {
  return <button type="button" role="switch" aria-label={label} aria-checked={checked} onClick={() => onChange(!checked)} className={cn('relative h-5 w-9 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring', checked ? 'bg-foreground' : 'bg-foreground/20')}><span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-background shadow-sm transition-transform', checked ? 'left-0.5 translate-x-4' : 'left-0.5')} /></button>;
}
function Swatch({ colors }: { colors: { accent: string; background: string; foreground: string } }) {
  return <span className="flex h-4 w-10 overflow-hidden rounded border border-foreground/15" aria-hidden="true">{[colors.background, colors.foreground, colors.accent].map((color, index) => <span key={index} className="flex-1" style={{ background: color }} />)}</span>;
}
function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange(value: number): void }) {
  const [draft, setDraft] = React.useState(String(value));
  React.useEffect(() => setDraft(String(value)), [value]);
  const commit = () => { const n = Number(draft); if (draft && Number.isInteger(n) && n >= min && n <= max) onChange(n); else setDraft(String(value)); };
  return <div className="flex h-8 items-center gap-2 rounded-md border border-input px-2.5"><input aria-label={label} className="w-9 bg-transparent text-right text-[13px] tabular-nums outline-none" type="number" min={min} max={max} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} /><span className="text-xs text-muted-foreground">px</span></div>;
}
function ColorField({ label, value, custom, onChange }: { label: string; value: string; custom: boolean; onChange(value: string): void }) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const commit = () => { if (/^#[a-f\d]{6}$/i.test(draft)) onChange(draft); else setDraft(value); };
  return <div className="flex items-center gap-2">
    <div className="flex h-8 items-center gap-2 rounded-md border border-input px-2"><input type="color" aria-label={`${label}选择器`} value={value} onChange={event => onChange(event.target.value)} className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" /><input aria-label={label} value={draft} spellCheck={false} maxLength={7} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }} className="w-[70px] bg-transparent font-mono text-xs uppercase outline-none" /></div>
    <button type="button" title={`重置${label}`} aria-label={`重置${label}`} disabled={!custom} className="text-muted-foreground disabled:opacity-20" onClick={() => onChange('')}><RotateCcw className="h-3.5 w-3.5" /></button>
  </div>;
}
export function AppearanceSettings({ value, onPreview, onCommit }: { value: Appearance; onPreview: (patch: Partial<Appearance>) => void; onCommit: (patch: Partial<Appearance>) => void }) {
  const appearance: Appearance = normalizeAppearance(value);
  const [systemDark, setSystemDark] = React.useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  React.useEffect(() => { const media = matchMedia('(prefers-color-scheme: dark)'); const update = () => setSystemDark(media.matches); media.addEventListener('change', update); return () => media.removeEventListener('change', update); }, []);
  const mode = appearance.themeMode === 'system' ? systemDark ? 'dark' : 'light' : appearance.themeMode;
  const key = mode === 'dark' ? 'darkProfile' : 'lightProfile';
  const savedProfile = appearance[key]!;
  const { profile, palette, theme } = resolveAppearance(appearance, mode);
  const mac = !isWebUI() && /Mac/i.test(navigator.platform);
  function updateProfile(patch: Partial<AppearanceProfile>, preview = false) {
    const next = { [key]: { ...savedProfile, ...patch } };
    (preview ? onPreview : onCommit)(next);
  }
  function updateTypography(patch: Partial<AppearanceProfile>, preview = false) {
    if (appearance.separateLightDark) updateProfile(patch, preview);
    else (preview ? onPreview : onCommit)({ ...patch, lightProfile: { ...appearance.lightProfile!, ...patch }, darkProfile: { ...appearance.darkProfile!, ...patch } });
  }
  function selectTheme(id: string) {
    const reset = { themeId: id, accent: '', background: '', foreground: '' };
    if (appearance.separateLightDark) updateProfile(reset);
    else onCommit({ cssThemeId: id, lightProfile: { ...appearance.lightProfile!, ...reset }, darkProfile: { ...appearance.darkProfile!, ...reset } });
  }
  return <div data-appearance-settings className="space-y-6">
    <section>
      <h2 className="mb-1 text-xs font-medium text-muted-foreground">视觉风格</h2>
      <div className="divide-y divide-border">
        <Row title="模式">
          <div role="radiogroup" aria-label="主题模式" className="flex gap-2">
            {([['light', '浅色', Sun], ['dark', '深色', Moon], ['system', '系统', Monitor]] as const).map(([id, label, Icon]) => <button type="button" role="radio" aria-label={label} aria-checked={appearance.themeMode === id} tabIndex={appearance.themeMode === id ? 0 : -1} onKeyDown={radioKey} key={id} onClick={() => onCommit({ themeMode: id })} className={cn('w-[76px] rounded-lg p-1.5 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2', appearance.themeMode === id ? 'bg-muted ring-1 ring-foreground/30' : 'hover:bg-muted/60')}>
              <span aria-hidden="true" className="relative flex h-10 overflow-hidden rounded border border-black/10" style={{ background: id === 'light' ? '#fff' : id === 'dark' ? '#202020' : 'linear-gradient(90deg, #fff 50%, #202020 50%)' }}><span className="w-4 border-r border-black/10 bg-black/5" /><span className="m-2 space-y-1"><span className="block h-0.5 w-6 rounded bg-zinc-400/70" /><span className="block h-0.5 w-4 rounded bg-zinc-400/50" /><span className="block h-0.5 w-5 rounded bg-zinc-400/40" /></span>{appearance.themeMode === id && <Check className="absolute bottom-1 right-1 h-3 w-3 rounded-full bg-zinc-500 text-white" />}</span>
              <span className="mt-1.5 flex items-center justify-center gap-1 text-[11px]"><Icon className="h-3 w-3" />{label}</span>
            </button>)}
          </div>
        </Row>
        <Row title="主题" description={appearance.separateLightDark ? `当前编辑${mode === 'dark' ? '深色' : '浅色'}外观` : undefined}>
          <DropdownMenu><DropdownMenuTrigger asChild><button type="button" aria-label="选择主题" className={`${selectClass} flex min-w-[184px] items-center gap-3`}><Swatch colors={palette} /><span className="flex-1 text-left">{theme.name}</span><ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /></button></DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-[60vh] w-64 overflow-y-auto"><DropdownMenuRadioGroup value={theme.id} onValueChange={selectTheme}>{THEME_CATALOG.filter(item => item[mode]).map(item => <DropdownMenuRadioItem key={item.id} value={item.id} className="gap-3 py-2.5"><Swatch colors={item[mode]} /><span><span className="block text-[13px]">{item.name}</span><span className="text-[11px] text-muted-foreground">{item.description}</span></span></DropdownMenuRadioItem>)}</DropdownMenuRadioGroup></DropdownMenuContent>
          </DropdownMenu>
        </Row>
        {(['accent', 'background', 'foreground'] as const).map((field, index) => <Row key={field} title={['强调色', '背景', '文字'][index]}><ColorField label={`${mode === 'dark' ? '深色' : '浅色'}${['强调色', '背景色', '文字色'][index]}`} value={palette[field]} custom={Boolean(savedProfile[field])} onChange={color => updateProfile({ [field]: color })} /></Row>)}
        <Row title="浅色与深色独立设置" description="分别保存主题、颜色、字体和对比度。"><Toggle label="浅色与深色独立设置" checked={Boolean(appearance.separateLightDark)} onChange={checked => {
          onCommit({ separateLightDark: checked });
        }} /></Row>
      </div>
    </section>
    <section><h2 className="mb-1 text-xs font-medium text-muted-foreground">字体</h2><div className="divide-y divide-border">
      <Row title="界面字号" description="调整整个应用的界面文字大小。"><NumberField label="界面字号" value={profile.uiFontSize} min={12} max={18} onChange={uiFontSize => updateTypography({ uiFontSize })} /></Row>
      <Row title="代码字号" description="用于聊天、文件预览和差异视图。"><NumberField label="代码字号" value={profile.codeFontSize} min={10} max={20} onChange={codeFontSize => updateTypography({ codeFontSize })} /></Row>
      {(['uiFont', 'contentFont', 'codeFont'] as const).map((field, index) => <Row key={field} title={['界面字体', '内容字体', '代码字体'][index]}><select aria-label={['界面字体', '内容字体', '代码字体'][index]} className={`${selectClass} w-[184px]`} value={profile[field]} onChange={event => updateTypography({ [field]: event.target.value })}>{(field === 'codeFont' ? CODE_FONTS : UI_FONTS).map(font => <option key={font.id} value={font.id}>{font.name}</option>)}</select></Row>)}
      {mac && <Row title="字体平滑" description="使用 macOS 原生字体抗锯齿。"><Toggle label="字体平滑" checked={Boolean(appearance.fontSmoothing)} onChange={fontSmoothing => onCommit({ fontSmoothing })} /></Row>}
    </div></section>
    <section><h2 className="mb-1 text-xs font-medium text-muted-foreground">界面与交互</h2><div className="divide-y divide-border">
      <Row title="减少动画"><select aria-label="减少动画" className={selectClass} value={appearance.reduceMotion} onChange={event => onCommit({ reduceMotion: event.target.value as Appearance['reduceMotion'] })}><option value="system">跟随系统</option><option value="always">开启</option><option value="never">关闭</option></select></Row>
      <Row title="半透明侧栏" description="透出窗口内的背景，并添加模糊效果。"><Toggle label="半透明侧栏" checked={Boolean(appearance.translucentSidebar)} onChange={translucentSidebar => onCommit({ translucentSidebar })} /></Row>
      <Row title="对比度"><div className="flex w-[184px] items-center gap-3"><Slider aria-label="对比度" min={0} max={100} step={1} value={[profile.contrast]} onValueChange={([contrast]) => updateTypography({ contrast }, true)} onValueCommit={([contrast]) => updateTypography({ contrast })} /><span className="w-6 text-right text-xs tabular-nums">{profile.contrast}</span></div></Row>
      <Row title="差异标记" description="用颜色、+ / − 符号或两者标记改动。"><select aria-label="差异标记" className={selectClass} value={appearance.diffMarkers} onChange={event => onCommit({ diffMarkers: event.target.value as Appearance['diffMarkers'] })}><option value="colors">颜色</option><option value="markers">+ / − 符号</option><option value="both">颜色与符号</option></select></Row>
      <Row title="使用手形光标" description="悬停在可操作元素上时显示手形光标。"><Toggle label="使用手形光标" checked={Boolean(appearance.pointerCursors)} onChange={pointerCursors => onCommit({ pointerCursors })} /></Row>
      {mac && <Row title="Dock 图标"><div role="radiogroup" aria-label="Dock 图标" className="flex gap-2">{([['default', '彩色', 'icon.png'], ['graphite', '石墨', 'icon-graphite.png'], ['inverted', '反色', 'icon-inverted.png']] as const).map(([id, label, filename]) => <button role="radio" aria-label={label} aria-checked={appearance.dockIcon === id} tabIndex={appearance.dockIcon === id ? 0 : -1} onKeyDown={radioKey} key={id} onClick={() => onCommit({ dockIcon: id })} className={cn('rounded-lg p-1.5', appearance.dockIcon === id && 'ring-1 ring-foreground/40 bg-muted')}><img alt="" src={`./build/${filename}`} className="h-12 w-12" /><span className="mt-1 block text-[10px]">{label}</span></button>)}</div></Row>}
    </div></section>
  </div>;
}
