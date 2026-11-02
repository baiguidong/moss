// Project icons are local, stroke-only 24 × 24 vectors. Never render supplied SVG markup.
export const PROJECT_ICON_PRESETS = [
  { name: 'folder', label: '项目', paths: ['M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z', 'M8 11v6M12 11v3M16 11v5'] },
  { name: 'rocket', label: '探索', paths: ['M12 15 9 12c2-6 6-9 12-9 0 6-3 10-9 12Z', 'M9 12H3l4-5h5M12 15v6l5-4v-5', 'M7 16c-3 0-4 2-4 5 3 0 5-1 5-4'] },
  { name: 'code', label: '开发', paths: ['M8 6 2 12l6 6M16 6l6 6-6 6M14 4l-4 16'] },
  { name: 'chart', label: '分析', paths: ['M3 3v18h18M7 16v-5M12 16V7M17 16v-9'] },
  { name: 'search', label: '研究', paths: ['M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0', 'M16 16l6 6'] },
  { name: 'book', label: '知识', paths: ['M12 5C8 2 4 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-2-1-6-2-10 1Zm0 0v16'] },
  { name: 'palette', label: '设计', paths: ['M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4 2 2 0 0 1 0-4h4a4 4 0 0 0 4-4c0-4-5-6-9-6Z', 'M7 8h.01M12 6h.01M17 8h.01M5 13h.01'] },
  { name: 'briefcase', label: '业务', paths: ['M8 7V4h8v3M3 7h18v13H3ZM3 12c5 4 13 4 18 0M12 12v4'] },
  { name: 'globe', label: '全球', paths: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z'] },
  { name: 'lightbulb', label: '创意', paths: ['M9 18h6v-2c0-2 4-3 4-7A7 7 0 0 0 5 9c0 4 4 5 4 7ZM9 22h6M12 18v-6'] },
  { name: 'heart', label: '关怀', paths: ['M20 5c-3-3-6-1-8 1-2-2-5-4-8-1-5 5 2 11 8 16 6-5 13-11 8-16Z'] },
  { name: 'target', label: '目标', paths: ['M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM17 12a5 5 0 1 1-10 0 5 5 0 0 1 10 0ZM12 12h.01'] },
];
export const PROJECT_ICON_COLORS = [
  { id: 'green', label: '绿色', value: '#16a34a' },
  { id: 'blue', label: '蓝色', value: '#3b82f6' },
  { id: 'violet', label: '紫色', value: '#8b5cf6' },
  { id: 'orange', label: '橙色', value: '#ea580c' },
  { id: 'rose', label: '玫红', value: '#e11d48' },
  { id: 'teal', label: '青色', value: '#0d9488' },
  { id: 'slate', label: '灰色', value: '#64748b' },
];
export const PROJECT_ICON_NAMES = PROJECT_ICON_PRESETS.map(icon => icon.name);
export const PROJECT_ICON_COLOR_IDS = PROJECT_ICON_COLORS.map(color => color.id);
export const DEFAULT_PROJECT_ICON = Object.freeze({ kind: 'builtin', name: 'folder', color: 'green' });

function validPath(value) {
  if (typeof value !== 'string' || value.length > 1200 || !/^[Mm]/.test(value.trim())) return false;
  const token = /[MmLlHhVvCcSsQqTtAaZz]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  if (value.replace(token, '').replace(/[\s,]/g, '')) return false;
  const tokens = value.match(token) || [];
  const arity = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  let index = 0, draws = false;
  while (index < tokens.length) {
    const command = tokens[index++].toLowerCase();
    if (!(command in arity)) return false;
    const numbers = [];
    while (index < tokens.length && !/^[a-z]$/i.test(tokens[index])) numbers.push(Number(tokens[index++]));
    const size = arity[command];
    if (numbers.some(number => !Number.isFinite(number) || Math.abs(number) > 96)) return false;
    if (size ? !numbers.length || numbers.length % size : numbers.length) return false;
    if (command === 'a') {
      for (let offset = 0; offset < numbers.length; offset += 7) {
        if (numbers[offset] < 0 || numbers[offset + 1] < 0 || ![0, 1].includes(numbers[offset + 3]) || ![0, 1].includes(numbers[offset + 4])) return false;
      }
    }
    if ((command !== 'm' && command !== 'z') || (command === 'm' && numbers.length > 2)) draws = true;
  }
  return draws;
}

/** Strict on writes; missing or invalid legacy data always has a visible fallback. */
export function normalizeProjectIcon(value, { strict = false } = {}) {
  if (value == null) return { ...DEFAULT_PROJECT_ICON };
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const color = value.color ?? DEFAULT_PROJECT_ICON.color;
    if (PROJECT_ICON_COLOR_IDS.includes(color)) {
      if (value.kind === 'builtin' && PROJECT_ICON_NAMES.includes(value.name)) return { kind: 'builtin', name: value.name, color };
      if (value.kind === 'generated' && Array.isArray(value.paths) && value.paths.length > 0 && value.paths.length <= 8 && value.paths.every(validPath)) {
        return { kind: 'generated', paths: value.paths.map(item => item.trim()), color };
      }
    }
  }
  if (strict) throw new Error('项目图标无效，请选择内置图标或重新生成。');
  return { ...DEFAULT_PROJECT_ICON };
}
