export type MossToolLoadingMode = 'always' | 'deferred';

export type MossToolDefinition = {
  name: string;
  description: string;
  defaultMode: MossToolLoadingMode;
};

export type MossToolGroup = {
  id: string;
  label: string;
  tools: readonly MossToolDefinition[];
};

export const MOSS_TOOL_GROUPS: readonly MossToolGroup[];
export const DEFAULT_MOSS_TOOL_LOADING: Readonly<Record<string, MossToolLoadingMode>>;
export function normalizeMossToolLoading(
  value: unknown,
  existing?: unknown,
): Record<string, MossToolLoadingMode>;
