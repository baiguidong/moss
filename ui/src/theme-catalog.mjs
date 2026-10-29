// Curated established palettes. Color seeds were checked against the installed
// Codex theme catalog; the Moss surface/token derivation is implemented locally.
const palette = (background, foreground, accent, string, keyword, comment) => ({ background, foreground, accent, string, keyword, comment });
export const THEME_CATALOG = [
  { id: 'codex', name: 'Codex', description: '中性 · 黑白', light: palette('#FFFFFF', '#0D0D0D', '#0169CC', '#008000', '#7C3AED', '#727272'), dark: palette('#111111', '#FCFCFC', '#0169CC', '#85DF7B', '#B06DFF', '#999999') },
  { id: 'github', name: 'GitHub', description: '清晰 · 蓝灰', light: palette('#FFFFFF', '#24292E', '#2188FF', '#032F62', '#D73A49', '#6A737D'), dark: palette('#0D1117', '#E6EDF3', '#1F6FEB', '#A5D6FF', '#FF7B72', '#8B949E') },
  { id: 'catppuccin', name: 'Catppuccin', description: '柔和 · 薰衣草紫', light: palette('#EFF1F5', '#4C4F69', '#8839EF', '#40A02B', '#8839EF', '#6C6F85'), dark: palette('#1E1E2E', '#CDD6F4', '#CBA6F7', '#A6E3A1', '#CBA6F7', '#9399B2') },
  { id: 'everforest', name: 'Everforest', description: '自然 · 森林绿', light: palette('#FDF6E3', '#5C6A72', '#93B259', '#6C782E', '#8F3F71', '#829181'), dark: palette('#2D353B', '#D3C6AA', '#A7C080', '#A7C080', '#D699B6', '#859289') },
  { id: 'gruvbox', name: 'Gruvbox', description: '复古 · 暖棕', light: palette('#FBF1C7', '#3C3836', '#458588', '#79740E', '#9D0006', '#7C6F64'), dark: palette('#282828', '#EBDBB2', '#458588', '#B8BB26', '#FB4934', '#A89984') },
  { id: 'solarized', name: 'Solarized', description: '低亮度 · 青墨', light: palette('#FDF6E3', '#657B83', '#B58900', '#2AA198', '#859900', '#93A1A1'), dark: palette('#002B36', '#839496', '#D30102', '#2AA198', '#859900', '#586E75') },
  { id: 'ayu', name: 'Ayu', description: '深色 · 琥珀金', dark: palette('#10141C', '#BFBDB6', '#E6B450', '#AAD94C', '#FF8F40', '#ACB6BF') },
  { id: 'dracula', name: 'Dracula', description: '深色 · 霓虹紫', dark: palette('#282A36', '#F8F8F2', '#FF79C6', '#F1FA8C', '#FF79C6', '#9AA9D7') },
  { id: 'nord', name: 'Nord', description: '深色 · 冰川蓝', dark: palette('#2E3440', '#D8DEE9', '#88C0D0', '#A3BE8C', '#81A1C1', '#8996AF') },
];
export const THEME_IDS = new Set(THEME_CATALOG.map(theme => theme.id));
export function migrateThemeId(id) {
  if (THEME_IDS.has(id)) return id;
  if (id === 'takt-theme') return 'everforest';
  if (['default', 'grid-theme', 'dot-theme', 'gradient-theme'].includes(id)) return 'codex';
  return undefined;
}
export const UI_FONTS = [
  { id: 'system', name: '系统默认', css: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  { id: 'sans', name: '无衬线', css: 'Arial, "Helvetica Neue", sans-serif' },
  { id: 'serif', name: '衬线', css: 'Georgia, "Songti SC", serif' },
  { id: 'mono', name: '等宽', css: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' },
];
export const CODE_FONTS = [
  { id: 'system', name: '系统等宽', css: 'ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace' },
  { id: 'menlo', name: 'Menlo', css: 'Menlo, Consolas, monospace' },
  { id: 'monaco', name: 'Monaco', css: 'Monaco, Consolas, monospace' },
  { id: 'courier', name: 'Courier', css: '"Courier New", Courier, monospace' },
];
