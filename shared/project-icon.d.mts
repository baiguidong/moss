export type ProjectIconValue =
  | { kind: 'builtin'; name: string; color: string }
  | { kind: 'generated'; paths: string[]; color: string };
export const PROJECT_ICON_PRESETS: { name: string; label: string; paths: string[] }[];
export const PROJECT_ICON_COLORS: { id: string; label: string; value: string }[];
export const PROJECT_ICON_NAMES: string[];
export const PROJECT_ICON_COLOR_IDS: string[];
export const DEFAULT_PROJECT_ICON: Readonly<{ kind: 'builtin'; name: 'folder'; color: 'green' }>;
export function normalizeProjectIcon(value: unknown, options?: { strict?: boolean }): ProjectIconValue;
