import * as React from 'react';
import {
  Bot,
  Check,
  LogIn,
  MessageSquare,
  Monitor,
  MoonStar,
  Palette,
  RefreshCw,
  Search,
  Server,
  SlidersHorizontal,
  SunMedium,
  Trash2,
  TriangleAlert,
  Wrench,
  X,
  type LucideIcon,
} from 'lucide-react';
import { BuddySummary } from '@/components/buddy';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useAdapterConfig } from '@/lib/adapter-config';
import { cleanIpcErrorMessage } from '@/lib/app-notifications';
import { PRESET_THEMES } from '@/theme/presets';
import type { DesktopSettings, FeishuAdapterStatus, ManagedRuntimeStatus, McpServerConfig, McpServerEntry, McpSettingsPayload } from '../types';

type ThemeMode = 'dark' | 'light' | 'system';
type NavigationGroupId = 'basic' | 'integrations' | 'personalization' | 'advanced';
type SectionId = 'basic-info' | 'model' | 'mcp' | 'feishu' | 'appearance' | 'buddy' | 'permission' | 'memory' | 'agent-execution' | 'tool-performance' | 'prompt' | 'service-address';

type SettingsViewProps = {
  settingsDraft: DesktopSettings | null;
  setSettingsDraft: React.Dispatch<React.SetStateAction<DesktopSettings | null>>;
  settingsNotice: string;
  autoSaveSettings: (key: keyof DesktopSettings, value: DesktopSettings[keyof DesktopSettings]) => Promise<void>;
  autoSaveImageSettings: (image: DesktopSettings['image']) => Promise<void>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  cssThemeId: string;
  setCssThemeId: (id: string) => void;
  onAutoCollapseToolCallsChange: (enabled: boolean) => void;
  buddyEnabled: boolean;
  onBuddyEnabledChange: (enabled: boolean) => void;
};

type SettingsSectionDefinition = {
  id: SectionId;
  title: string;
  keywords: string[];
};

type SettingsNavigationGroup = {
  id: NavigationGroupId;
  title: string;
  icon: LucideIcon;
  iconGradientClassName: string;
  keywords: string[];
  sections: SettingsSectionDefinition[];
};

type SettingsSectionProps = {
  id: SectionId;
  title: string;
  children: React.ReactNode;
  sectionRef: (element: HTMLElement | null) => void;
};

type SettingsGroupProps = {
  children: React.ReactNode;
  className?: string;
};

type SettingsRowProps = {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  stacked?: boolean;
  controlClassName?: string;
  className?: string;
};

type ToggleProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
};

type NavigationGroupButtonProps = {
  group: SettingsNavigationGroup;
  active: boolean;
  onClick: () => void;
  compact?: boolean;
};

type ThemeModeButtonProps = {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
};

type ThemePresetButtonProps = {
  selected: boolean;
  themeId: string;
  themeName: string;
  onClick: () => void;
};

const DEFAULT_IMAGE_SETTINGS: DesktopSettings['image'] = {
  provider: 'minimax',
  url: '',
  apiKey: '',
  model: '',
};

const IMAGE_PROVIDER_DEFAULT_URLS: Record<string, string> = {
  minimax: 'https://api.minimaxi.com/v1/image_generation',
  openai: 'https://api.openai.com/v1',
};

const IMAGE_PROVIDER_DEFAULT_MODELS: Record<string, string> = {
  minimax: 'image-01',
  openai: 'gpt-image-1',
};

const DEFAULT_SESSION_MEMORY_SETTINGS: NonNullable<DesktopSettings['sessionMemory']> = {
  enabled: true,
  compactEnabled: true,
  minimumMessageTokensToInit: 10000,
  minimumTokensBetweenUpdate: 5000,
  toolCallsBetweenUpdates: 3,
  compactMinTokens: 10000,
  compactMinTextBlockMessages: 5,
  compactMaxTokens: 40000,
};

const DEFAULT_AUTO_MEMORY_SETTINGS: NonNullable<DesktopSettings['autoMemory']> = {
  enabled: true,
  extractionEnabled: false,
  extractionIntervalTurns: 1,
  pastContextSearchEnabled: false,
  dreamEnabled: false,
  dreamMinHours: 24,
  dreamMinSessions: 5,
};

const DEFAULT_ADVANCED_SETTINGS: NonNullable<DesktopSettings['advanced']> = {
  moss_auto_background_agents: false,
  moss_bash_ast_permissions: false,
  moss_hive_evidence: false,
  moss_scratchpad: false,
  moss_idle_session_cleanup: false,
  moss_streaming_tool_execution: false,
  moss_plan_mode_interview: true,
  moss_fast_web_search: false,
  moss_memory_learn_from_corrections: false,
  moss_large_tool_result_protection: false,
  moss_tool_result_budget_chars: 200_000,
  moss_mcp_output_token_limit: 25_000,
  moss_file_read_max_size_bytes: 256 * 1024,
  moss_file_read_max_tokens: 25_000,
  moss_request_attribution_enabled: true,
  moss_context_compaction_strategy: 'proactive',
  moss_session_debug_logging: false,
};

const SETTINGS_NAVIGATION_GROUPS: SettingsNavigationGroup[] = [
  {
    id: 'basic',
    title: '基础设置',
    icon: Monitor,
    iconGradientClassName: 'from-sky-400 to-blue-600',
    keywords: ['基础', '基本', '常规'],
    sections: [
      {
        id: 'basic-info',
        title: '基本信息',
        keywords: ['连接', 'connection', 'remote', 'server', 'workspace', '认证', '运行环境', 'runtime', 'node', 'python', 'git', 'bash'],
      },
      {
        id: 'model',
        title: '模型',
        keywords: ['文本模型', '图片模型', 'model', 'image', 'provider', 'api', 'key', 'anthropic', 'claude', 'url'],
      },
    ],
  },
  {
    id: 'integrations',
    title: '扩展与集成',
    icon: Wrench,
    iconGradientClassName: 'from-lime-400 to-emerald-600',
    keywords: ['扩展', '集成', 'integration'],
    sections: [
      {
        id: 'mcp',
        title: 'MCP',
        keywords: ['mcp', 'server', 'tool', '工具', '服务器', '上下文协议'],
      },
      {
        id: 'feishu',
        title: '飞书',
        keywords: ['飞书', 'feishu', '机器人', 'bot', '配对'],
      },
    ],
  },
  {
    id: 'personalization',
    title: '个性化',
    icon: Palette,
    iconGradientClassName: 'from-amber-400 to-orange-600',
    keywords: ['个性化', 'personalization', '外观', 'buddy'],
    sections: [
      {
        id: 'appearance',
        title: '外观',
        keywords: ['appearance', 'theme', 'background', 'collapse', '主题', '工具', '折叠'],
      },
      {
        id: 'buddy',
        title: 'Buddy',
        keywords: ['buddy', 'pet', 'companion', '伴侣', '宠物'],
      },
    ],
  },
  {
    id: 'advanced',
    title: '高级设置',
    icon: SlidersHorizontal,
    iconGradientClassName: 'from-violet-400 to-fuchsia-600',
    keywords: ['高级', 'advanced'],
    sections: [
      {
        id: 'permission',
        title: '权限',
        keywords: ['permission', 'allow', '权限确认', 'bypass', 'bash', 'ast', '命令解析'],
      },
      {
        id: 'memory',
        title: '记忆',
        keywords: ['memory', 'session', 'compact', 'summary', '上下文', '压缩', 'dream', '提取', '纠正'],
      },
      {
        id: 'agent-execution',
        title: 'Agent 与执行',
        keywords: ['agent', 'verification', '验证', 'scratchpad', 'plan', '后台', '临时工作区', '网页搜索', '最大轮次', 'thinking', '思考模式'],
      },
      {
        id: 'tool-performance',
        title: '工具与性能',
        keywords: ['tool', 'performance', 'streaming', '工具结果', 'mcp', 'read', '文件读取', '闲置', '性能'],
      },
      {
        id: 'prompt',
        title: '系统提示',
        keywords: ['prompt', '系统提示', 'append', 'instruction', '归因', 'attribution'],
      },
      {
        id: 'service-address',
        title: '服务地址',
        keywords: ['skillhub', 'skill', '专家中心', 'expert', 'experthub', 'market', 'api', '公网', '根地址'],
      },
    ],
  },
];

const SECTION_GROUP_IDS = Object.fromEntries(
  SETTINGS_NAVIGATION_GROUPS.flatMap((group) => group.sections.map((section) => [section.id, group.id])),
) as Record<SectionId, NavigationGroupId>;

const FIELD_CLASS_NAME =
  'h-9 rounded-xl border-sidebar-border bg-sidebar-accent/70 text-[13px] text-sidebar-foreground shadow-none placeholder:text-sidebar-foreground/45';
const SELECT_CLASS_NAME =
  'h-9 w-full rounded-xl border border-sidebar-border bg-sidebar-accent/70 px-3 text-[13px] text-sidebar-foreground shadow-none outline-none transition focus:border-sidebar-ring focus:ring-4 focus:ring-sidebar-ring/15';

const THEME_PREVIEW_STYLES: Record<string, React.CSSProperties> = {
  default: {
    background: 'linear-gradient(135deg, #ffffff 0%, #f1f5f9 100%)',
  },
  'grid-theme': {
    backgroundColor: '#f8fafc',
    backgroundImage:
      'linear-gradient(rgba(15, 23, 42, 0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 23, 42, 0.08) 1px, transparent 1px)',
    backgroundSize: '14px 14px',
  },
  'dot-theme': {
    backgroundColor: '#f8fafc',
    backgroundImage: 'radial-gradient(rgba(15, 23, 42, 0.14) 1.1px, transparent 1.1px)',
    backgroundSize: '12px 12px',
  },
  'gradient-theme': {
    background: 'linear-gradient(135deg, #eefaf5 0%, #d8ebe7 100%)',
  },
};

function Surface({ children, className }: SettingsGroupProps) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[20px] border border-sidebar-border bg-sidebar-accent/58 text-sidebar-foreground shadow-none backdrop-blur-xl',
        className,
      )}
    >
      {children}
    </div>
  );
}

function SettingsSection({ id, title, children, sectionRef }: SettingsSectionProps) {
  return (
    <section id={id} ref={sectionRef} className="scroll-mt-6">
      <div className="mb-4 px-1">
        <h2 className="text-[15px] font-semibold text-foreground">
          {title}
        </h2>
      </div>
      {children}
    </section>
  );
}

function SettingsGroup({ children, className }: SettingsGroupProps) {
  return (
    <Surface className={cn('divide-y divide-sidebar-border', className)}>
      {children}
    </Surface>
  );
}

function SettingsRow({
  title,
  description,
  children,
  stacked = false,
  controlClassName,
  className,
}: SettingsRowProps) {
  if (stacked) {
    return (
      <div className={cn('px-4 py-4', className)}>
        <div className="space-y-3">
          <div>
            <div className="text-[13px] font-medium text-foreground">{title}</div>
            {description ? (
              <div className="mt-1 text-xs leading-6 text-muted-foreground">{description}</div>
            ) : null}
          </div>
          {children}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('px-4 py-3.5', className)}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="min-w-0 sm:max-w-[320px]">
          <div className="text-[13px] font-medium text-foreground">{title}</div>
          {description ? (
            <div className="mt-1 text-xs leading-6 text-muted-foreground">{description}</div>
          ) : null}
        </div>
        <div className={cn('w-full sm:shrink-0', controlClassName)}>{children}</div>
      </div>
    </div>
  );
}

function Toggle({ checked, onCheckedChange, label }: ToggleProps) {
  return (
    <label className="relative inline-flex h-6 w-11 cursor-pointer items-center">
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        aria-label={label}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span
        className={cn(
          'h-full w-full rounded-full bg-black/[0.12] transition-colors after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:shadow-[0_1px_2px_rgba(0,0,0,0.18)] after:transition-transform peer-focus-visible:ring-4 peer-focus-visible:ring-sky-500/20 peer-checked:bg-[#34c759] peer-checked:after:translate-x-5 dark:bg-white/[0.12] dark:peer-focus-visible:ring-primary/25 dark:peer-checked:bg-emerald-500',
        )}
      />
    </label>
  );
}

function NavigationGroupButton({ group, active, onClick, compact = false }: NavigationGroupButtonProps) {
  const Icon = group.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group flex items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors',
        compact ? 'min-w-max flex-none' : 'w-full',
        active
          ? 'bg-sidebar-accent text-sidebar-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--sidebar-border)_90%,transparent)]'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/80 hover:text-sidebar-foreground',
      )}
    >
      <span
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br text-white shadow-[0_10px_20px_-12px_rgba(15,23,42,0.6)]',
          group.iconGradientClassName,
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="text-sm font-medium">{group.title}</span>
    </button>
  );
}

function ThemeModeButton({ active, icon: Icon, label, onClick }: ThemeModeButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-0 flex-1 flex-col items-center gap-2 rounded-[18px] border px-3 py-3 text-center text-xs font-medium transition-colors',
        active
          ? 'border-sky-500 bg-sky-50 text-sky-700 shadow-[0_18px_30px_-26px_rgba(14,116,244,0.7)] dark:border-primary dark:bg-primary/10 dark:text-primary'
          : 'border-sidebar-border bg-sidebar-accent/65 text-sidebar-foreground/70 hover:bg-sidebar-accent/85 hover:text-sidebar-foreground',
      )}
    >
      <span
        className={cn(
          'flex h-9 w-9 items-center justify-center rounded-full',
          active
            ? 'bg-gradient-to-br from-amber-300 to-orange-400 text-white dark:from-emerald-300 dark:to-teal-500'
            : 'bg-sidebar/90 text-sidebar-foreground',
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <span className="truncate">{label}</span>
    </button>
  );
}

function ThemePresetButton({ selected, themeId, themeName, onClick }: ThemePresetButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-w-[110px] flex-1 items-center gap-3 rounded-[18px] border px-3 py-3 text-left transition-colors',
        selected
          ? 'border-sky-500 bg-sky-50/90 text-sky-700 dark:border-primary dark:bg-primary/10 dark:text-primary'
          : 'border-sidebar-border bg-sidebar-accent/65 text-sidebar-foreground hover:bg-sidebar-accent/85',
      )}
    >
      <span
        className="block h-9 w-14 shrink-0 rounded-xl border border-black/5 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)] dark:border-white/10"
        style={THEME_PREVIEW_STYLES[themeId] || THEME_PREVIEW_STYLES.default}
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium">{themeName}</span>
      </span>
      {selected ? <Check className="h-4 w-4 shrink-0" /> : null}
    </button>
  );
}

type McpTransport = 'stdio' | 'http' | 'sse';
type KeyValueRow = { id: string; key: string; value: string };

function createKeyValueRow(key = '', value = ''): KeyValueRow {
  return { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, key, value };
}

function recordToRows(record?: Record<string, string>): KeyValueRow[] {
  const entries = Object.entries(record ?? {});
  return entries.length > 0 ? entries.map(([key, value]) => createKeyValueRow(key, value)) : [createKeyValueRow()];
}

function rowsToRecord(rows: KeyValueRow[]): Record<string, string> | undefined {
  const result: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (!key) continue;
    result[key] = row.value;
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function splitArgs(value: string): string[] {
  return value
    .split('\n')
    .map((arg) => arg.trim())
    .filter(Boolean);
}

function getMcpTransport(config: McpServerConfig): McpTransport {
  return (config.type ?? 'stdio') as McpTransport;
}

function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  rows: KeyValueRow[];
  onChange: (rows: KeyValueRow[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  const updateRow = (id: string, patch: Partial<KeyValueRow>) => {
    onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };
  const removeRow = (id: string) => {
    const next = rows.filter((row) => row.id !== id);
    onChange(next.length > 0 ? next : [createKeyValueRow()]);
  };

  return (
    <div className="space-y-2">
      {rows.map((row) => (
        <div key={row.id} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <Input
            className={FIELD_CLASS_NAME}
            value={row.key}
            onChange={(event) => updateRow(row.id, { key: event.target.value })}
            placeholder={keyPlaceholder}
          />
          <Input
            className={FIELD_CLASS_NAME}
            value={row.value}
            onChange={(event) => updateRow(row.id, { value: event.target.value })}
            placeholder={valuePlaceholder}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-9 rounded-xl border-black/10 bg-white/90 px-3 dark:border-white/10 dark:bg-background/75"
            onClick={() => removeRow(row.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        size="sm"
        className="h-9 rounded-xl border-black/10 bg-white/90 px-3 dark:border-white/10 dark:bg-background/75"
        onClick={() => onChange([...rows, createKeyValueRow()])}
      >
        添加一行
      </Button>
    </div>
  );
}

function McpSettings() {
  const [payload, setPayload] = React.useState<McpSettingsPayload | null>(null);
  const [selectedName, setSelectedName] = React.useState<string>('');
  const [draftName, setDraftName] = React.useState('');
  const [draftEnabled, setDraftEnabled] = React.useState(true);
  const [draftTransport, setDraftTransport] = React.useState<McpTransport>('stdio');
  const [draftCommand, setDraftCommand] = React.useState('');
  const [draftArgs, setDraftArgs] = React.useState('');
  const [draftUrl, setDraftUrl] = React.useState('');
  const [draftEnvRows, setDraftEnvRows] = React.useState<KeyValueRow[]>(() => [createKeyValueRow()]);
  const [draftHeaderRows, setDraftHeaderRows] = React.useState<KeyValueRow[]>(() => [createKeyValueRow()]);
  const [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState('');
  const [loading, setLoading] = React.useState(false);

  const servers = payload?.servers ?? [];
  const selected = servers.find((server) => server.name === selectedName) ?? null;

  const loadDraftFromConfig = (config: McpServerConfig) => {
    const transport = getMcpTransport(config);
    setDraftTransport(transport);
    if (transport === 'stdio') {
      const stdioConfig = config as Extract<McpServerConfig, { type?: 'stdio' }>;
      setDraftCommand(stdioConfig.command ?? '');
      setDraftArgs((stdioConfig.args ?? []).join('\n'));
      setDraftUrl('');
      setDraftEnvRows(recordToRows(stdioConfig.env));
      setDraftHeaderRows([createKeyValueRow()]);
    } else {
      const remoteConfig = config as Extract<McpServerConfig, { type: 'http' | 'sse' }>;
      setDraftCommand('');
      setDraftArgs('');
      setDraftUrl(remoteConfig.url ?? '');
      setDraftEnvRows([createKeyValueRow()]);
      setDraftHeaderRows(recordToRows(remoteConfig.headers));
    }
  };

  const resetDraftForNewServer = React.useCallback((clearMessages = true) => {
    setSelectedName('');
    setDraftName('');
    setDraftEnabled(true);
    setDraftTransport('stdio');
    setDraftCommand('');
    setDraftArgs('');
    setDraftUrl('');
    setDraftEnvRows([createKeyValueRow()]);
    setDraftHeaderRows([createKeyValueRow()]);
    if (clearMessages) {
      setNotice('');
      setError('');
    }
  }, []);

  const loadServers = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await window.agentDesktop.listMcpServers();
      setPayload(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const selectServer = (server: McpServerEntry) => {
    setSelectedName(server.name);
    setDraftName(server.name);
    setDraftEnabled(server.enabled);
    loadDraftFromConfig(server.config);
    setNotice('');
    setError('');
  };

  const createServer = () => {
    resetDraftForNewServer();
  };

  const applyPayload = (next: McpSettingsPayload) => {
    setPayload(next);
    const reset = next.resetSessionCount ?? 0;
    const skipped = next.skippedBusySessionCount ?? 0;
    setNotice(`已保存，${reset} 个本地会话将在下次发送前重新加载 MCP${skipped ? `，${skipped} 个忙碌会话稍后生效` : ''}。`);
  };

  const saveServer = async () => {
    setError('');
    setNotice('');
    const name = draftName.trim();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      setError('名称只能包含字母、数字、连字符和下划线');
      return;
    }
    let config: McpServerConfig;
    if (draftTransport === 'stdio') {
      if (!draftCommand.trim()) {
        setError('stdio MCP server 需要 command');
        return;
      }
      config = {
        type: 'stdio',
        command: draftCommand.trim(),
        args: splitArgs(draftArgs),
        ...(rowsToRecord(draftEnvRows) ? { env: rowsToRecord(draftEnvRows) } : {}),
      };
    } else {
      if (!draftUrl.trim()) {
        setError(`${draftTransport} MCP server 需要 URL`);
        return;
      }
      config = {
        type: draftTransport,
        url: draftUrl.trim(),
        ...(rowsToRecord(draftHeaderRows) ? { headers: rowsToRecord(draftHeaderRows) } : {}),
      };
    }

    try {
      if (draftTransport !== 'stdio') {
        const parsed = new URL(draftUrl.trim());
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          setError('URL 只支持 http 或 https');
          return;
        }
      }
    } catch {
      setError('URL 格式不正确');
      return;
    }

    try {
      setLoading(true);
      const next = await window.agentDesktop.upsertMcpServer({
        previousName: selectedName && selected ? selected.name : undefined,
        name,
        enabled: draftEnabled,
        config,
      });
      applyPayload(next);
      resetDraftForNewServer(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleServer = async (server: McpServerEntry, enabled: boolean) => {
    setError('');
    setNotice('');
    try {
      setLoading(true);
      const next = await window.agentDesktop.setMcpServerEnabled({ name: server.name, enabled });
      applyPayload(next);
      if (server.name === selectedName) {
        setDraftEnabled(enabled);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const removeServer = async (name: string) => {
    if (!name) return;
    setError('');
    setNotice('');
    try {
      setLoading(true);
      const next = await window.agentDesktop.removeMcpServer({ name });
      setPayload(next);
      if (name === selectedName) {
        resetDraftForNewServer(false);
      }
      setNotice('已删除 MCP server，后续会话会使用更新后的配置。');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SettingsGroup>
      <SettingsRow
        title="MCP servers"
        description="启用后会写入 agent MCP 配置，并重置空闲本地会话 runtime。当前发送中的会话会在下一次重建后生效。"
        stacked
      >
        <div className="grid gap-3 lg:grid-cols-[260px_minmax(0,1fr)]">
          <div className="rounded-[18px] border border-sidebar-border bg-sidebar/45 p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="px-2 text-xs text-muted-foreground">
                {loading ? '加载中...' : `${servers.length} 个 server`}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-xl border-black/10 bg-white/90 px-3 dark:border-white/10 dark:bg-background/75"
                onClick={createServer}
              >
                新增
              </Button>
            </div>
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {servers.length === 0 ? (
                <div className="rounded-xl border border-dashed border-sidebar-border px-3 py-5 text-center text-xs text-muted-foreground">
                  还没有 MCP server
                </div>
              ) : (
                servers.map((server) => (
                  <div
                    key={server.name}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors',
                      server.name === selectedName
                        ? 'bg-sidebar-accent text-sidebar-foreground'
                        : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      onClick={() => selectServer(server)}
                    >
                      <span className={cn('h-2 w-2 shrink-0 rounded-full', server.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/35')} />
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{server.name}</span>
                    </button>
                    <Toggle
                      checked={server.enabled}
                      onCheckedChange={(checked) => void toggleServer(server, checked)}
                      label={`${server.enabled ? '禁用' : '启用'} ${server.name}`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 w-8 rounded-xl border-black/10 bg-white/90 p-0 dark:border-white/10 dark:bg-background/75"
                      onClick={() => void removeServer(server.name)}
                      disabled={loading}
                      aria-label={`删除 ${server.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
              <Input
                className={FIELD_CLASS_NAME}
                value={draftName}
                onChange={(event) => setDraftName(event.target.value)}
                placeholder="server_name"
              />
              <div className="flex items-center justify-between gap-3 rounded-xl border border-sidebar-border bg-sidebar-accent/60 px-3">
                <span className="text-xs text-muted-foreground">启用</span>
                <Toggle
                  checked={draftEnabled}
                  onCheckedChange={setDraftEnabled}
                  label="启用 MCP server"
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]">
              <select
                className={SELECT_CLASS_NAME}
                value={draftTransport}
                onChange={(event) => setDraftTransport(event.target.value as McpTransport)}
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
              {draftTransport === 'stdio' ? (
                <Input
                  className={FIELD_CLASS_NAME}
                  value={draftCommand}
                  onChange={(event) => setDraftCommand(event.target.value)}
                  placeholder="npx"
                />
              ) : (
                <Input
                  className={FIELD_CLASS_NAME}
                  value={draftUrl}
                  onChange={(event) => setDraftUrl(event.target.value)}
                  placeholder={draftTransport === 'http' ? 'https://example.com/mcp' : 'https://example.com/sse'}
                />
              )}
            </div>

            {draftTransport === 'stdio' ? (
              <>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">参数</div>
                  <Textarea
                    className="min-h-[108px] rounded-[18px] border-sidebar-border bg-sidebar-accent/70 font-mono text-xs text-sidebar-foreground shadow-none placeholder:text-sidebar-foreground/45"
                    value={draftArgs}
                    onChange={(event) => setDraftArgs(event.target.value)}
                    placeholder={'每行一个参数\n-y\n@modelcontextprotocol/server-filesystem\n~'}
                    spellCheck={false}
                  />
                </div>
                <div>
                  <div className="mb-2 text-xs font-medium text-muted-foreground">环境变量</div>
                  <KeyValueEditor
                    rows={draftEnvRows}
                    onChange={setDraftEnvRows}
                    keyPlaceholder="API_KEY"
                    valuePlaceholder="value"
                  />
                </div>
              </>
            ) : (
              <div>
                <div className="mb-2 text-xs font-medium text-muted-foreground">Headers</div>
                <KeyValueEditor
                  rows={draftHeaderRows}
                  onChange={setDraftHeaderRows}
                  keyPlaceholder="Authorization"
                  valuePlaceholder="Bearer ..."
                />
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0 text-xs text-muted-foreground">
                {notice ? <span className="text-emerald-500">{notice}</span> : null}
                {error ? <span className="text-destructive">{error}</span> : null}
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  size="sm"
                  className="h-9 rounded-xl px-4"
                  onClick={saveServer}
                  disabled={loading}
                >
                  保存
                </Button>
              </div>
            </div>
          </div>
        </div>
      </SettingsRow>
    </SettingsGroup>
  );
}

function RuntimeStatusBadge({ runtime }: { runtime: { installed?: boolean; skipped?: boolean; resourceAvailable?: boolean } }) {
  if (runtime.skipped) {
    return (
      <span className="rounded-full bg-sidebar-accent px-2.5 py-1 text-xs font-medium text-muted-foreground">
        不适用
      </span>
    );
  }
  if (runtime.installed) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2.5 py-1 text-xs font-medium text-emerald-600 dark:text-emerald-300">
        <Check className="h-3.5 w-3.5" />
        已安装
      </span>
    );
  }
  if (runtime.resourceAvailable === false) {
    return (
      <span className="rounded-full bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-700 dark:text-rose-300">
        资源缺失
      </span>
    );
  }
  return (
    <span className="rounded-full bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-300">
      未安装
    </span>
  );
}

function RuntimeRow({
  name,
  description,
  runtime,
  enabled,
  busy,
  onEnabledChange,
}: {
  name: string;
  description?: string;
  runtime: { installed?: boolean; skipped?: boolean; resourceAvailable?: boolean };
  enabled: boolean;
  busy: boolean;
  onEnabledChange: (enabled: boolean) => void;
}) {
  return (
    <div className="px-4 py-3.5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-[13px] font-medium text-foreground">{name}</p>
            <RuntimeStatusBadge runtime={runtime} />
          </div>
          {description ? <p className="mt-1 text-xs leading-6 text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Toggle
            checked={enabled}
            onCheckedChange={onEnabledChange}
            label={name}
          />
          {busy ? <RefreshCw className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" /> : null}
        </div>
      </div>
    </div>
  );
}

function RuntimeSettings({
  settingsDraft,
  updateSetting,
}: {
  settingsDraft: DesktopSettings;
  updateSetting: <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => void;
}) {
  const [status, setStatus] = React.useState<ManagedRuntimeStatus | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [installingRuntime, setInstallingRuntime] = React.useState<'node' | 'python' | 'git' | null>(null);
  const [notice, setNotice] = React.useState('');
  const [error, setError] = React.useState('');

  const refreshStatus = React.useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStatus(await window.agentDesktop.getManagedRuntimeStatus());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void refreshStatus();
  }, [refreshStatus]);

  React.useEffect(() => {
    if (!status?.installing) return undefined;
    const timer = window.setTimeout(() => {
      void refreshStatus();
    }, 2000);
    return () => window.clearTimeout(timer);
  }, [refreshStatus, status?.installing]);

  const runtimeSettings = {
    node: settingsDraft.managedRuntimes?.node !== false,
    python: settingsDraft.managedRuntimes?.python !== false,
    git: settingsDraft.managedRuntimes?.git !== false,
  };

  const updateRuntimeEnabled = async (name: 'node' | 'python' | 'git', enabled: boolean) => {
    const nextManagedRuntimes = {
      ...runtimeSettings,
      [name]: enabled,
    };
    updateSetting('managedRuntimes', nextManagedRuntimes);
    setNotice('');
    setError('');
    if (!enabled) {
      setNotice(`${name} 已关闭，agent 不会使用该运行环境`);
      return;
    }
    setInstallingRuntime(name);
    try {
      await window.agentDesktop.ensureManagedRuntimes({
        node: name === 'node',
        python: name === 'python',
        git: name === 'git',
      });
      const nextStatus = await window.agentDesktop.getManagedRuntimeStatus();
      setStatus(nextStatus);
      const runtime = nextStatus[name];
      setNotice(runtime.installed || runtime.skipped ? `${name} 已启用` : `${name} 已打开，等待运行环境安装`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingRuntime(null);
    }
  };

  const node = status?.node ?? {};
  const python = status?.python ?? {};
  const git = status?.git ?? {};

  return (
    <div className="space-y-3">
      <SettingsGroup>
        <RuntimeRow
          name="Node.js"
          runtime={node}
          enabled={runtimeSettings.node}
          busy={installingRuntime === 'node' || Boolean(status?.installing)}
          onEnabledChange={(enabled) => void updateRuntimeEnabled('node', enabled)}
        />
        <RuntimeRow
          name="Python"
          runtime={python}
          enabled={runtimeSettings.python}
          busy={installingRuntime === 'python' || Boolean(status?.installing)}
          onEnabledChange={(enabled) => void updateRuntimeEnabled('python', enabled)}
        />
        {!git.skipped ? (
          <RuntimeRow
            name="Git Bash"
            description="仅 Windows 使用，提供 Claude Code 需要的 bash.exe 和 git.exe。"
            runtime={git}
            enabled={runtimeSettings.git}
            busy={installingRuntime === 'git' || Boolean(status?.installing)}
            onEnabledChange={(enabled) => void updateRuntimeEnabled('git', enabled)}
          />
        ) : null}
      </SettingsGroup>

      {notice || error ? (
        <div className={cn(
          'rounded-[18px] border px-4 py-3 text-xs leading-6',
          error
            ? 'border-rose-200/80 bg-rose-50/90 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100'
            : 'border-emerald-200/80 bg-emerald-50/90 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100',
        )}>
          {error || notice}
        </div>
      ) : null}
    </div>
  );
}

export function SettingsView({
  settingsDraft,
  setSettingsDraft,
  settingsNotice,
  autoSaveSettings,
  autoSaveImageSettings,
  themeMode,
  setThemeMode,
  cssThemeId,
  setCssThemeId,
  onAutoCollapseToolCallsChange,
  buddyEnabled,
  onBuddyEnabledChange,
}: SettingsViewProps) {
  const [searchQuery, setSearchQuery] = React.useState('');
  const [remoteAuthState, setRemoteAuthState] = React.useState<'idle' | 'loading' | 'success'>('idle');
  const [remoteAuthError, setRemoteAuthError] = React.useState('');
  const deferredSearchQuery = React.useDeferredValue(searchQuery.trim().toLowerCase());
  const [activeGroupId, setActiveGroupId] = React.useState<NavigationGroupId>('basic');
  const [activeSection, setActiveSection] = React.useState<SectionId>('basic-info');
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const sectionRefs = React.useRef<Record<SectionId, HTMLElement | null>>({
    'basic-info': null,
    model: null,
    mcp: null,
    feishu: null,
    appearance: null,
    buddy: null,
    permission: null,
    memory: null,
    'agent-execution': null,
    'tool-performance': null,
    prompt: null,
    'service-address': null,
  });

  const visibleNavigationGroups = SETTINGS_NAVIGATION_GROUPS.flatMap((group) => {
    if (!deferredSearchQuery) return [group];
    const groupMatches = [group.title, ...group.keywords]
      .join(' ')
      .toLowerCase()
      .includes(deferredSearchQuery);
    const sections = groupMatches
      ? group.sections
      : group.sections.filter((section) => (
          [section.title, ...section.keywords]
            .join(' ')
            .toLowerCase()
            .includes(deferredSearchQuery)
        ));
    return sections.length > 0 ? [{ ...group, sections }] : [];
  });
  const activeGroup = SETTINGS_NAVIGATION_GROUPS.find((group) => group.id === activeGroupId)
    ?? SETTINGS_NAVIGATION_GROUPS[0];
  const visibleSections = deferredSearchQuery
    ? visibleNavigationGroups.flatMap((group) => group.sections)
    : activeGroup.sections;
  const visibleSectionKey = visibleSections.map((section) => section.id).join('|');
  const firstVisibleSectionId = visibleSections[0]?.id;
  const activeSectionVisible = visibleSections.some((section) => section.id === activeSection);
  const imageDraft = settingsDraft?.image || DEFAULT_IMAGE_SETTINGS;
  const sessionMemoryDraft = {
    ...DEFAULT_SESSION_MEMORY_SETTINGS,
    ...(settingsDraft?.sessionMemory || {}),
  };
  const autoMemoryDraft = {
    ...DEFAULT_AUTO_MEMORY_SETTINGS,
    ...(settingsDraft?.autoMemory || {}),
  };
  const advancedDraft = {
    ...DEFAULT_ADVANCED_SETTINGS,
    ...(settingsDraft?.advanced || {}),
  };

  React.useEffect(() => {
    if (!activeSectionVisible && firstVisibleSectionId) {
      setActiveSection(firstVisibleSectionId);
      setActiveGroupId(SECTION_GROUP_IDS[firstVisibleSectionId]);
    }
  }, [activeSectionVisible, firstVisibleSectionId]);

  React.useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const updateActive = () => {
      const threshold = container.scrollTop + 108;
      let nextSection = firstVisibleSectionId || 'basic-info';

      const positionedSections = visibleSections
        .map((section) => ({ section, element: sectionRefs.current[section.id] }))
        .filter((entry): entry is { section: SettingsSectionDefinition; element: HTMLElement } => Boolean(entry.element))
        .sort((left, right) => left.element.offsetTop - right.element.offsetTop);

      for (const { section, element } of positionedSections) {
        if (element.offsetTop <= threshold) {
          nextSection = section.id;
        }
      }

      setActiveSection((current) => (current === nextSection ? current : nextSection));
      if (deferredSearchQuery) {
        setActiveGroupId(SECTION_GROUP_IDS[nextSection]);
      }
    };

    const raf = window.requestAnimationFrame(updateActive);
    container.addEventListener('scroll', updateActive, { passive: true });
    window.addEventListener('resize', updateActive);

    return () => {
      window.cancelAnimationFrame(raf);
      container.removeEventListener('scroll', updateActive);
      window.removeEventListener('resize', updateActive);
    };
  }, [
    firstVisibleSectionId,
    deferredSearchQuery,
    visibleSectionKey,
    settingsDraft?.remoteEnabled,
    settingsDraft?.thinkingMode,
    settingsDraft?.sessionMemory,
    settingsDraft?.autoMemory,
    settingsDraft?.advanced,
    buddyEnabled,
  ]);

  const selectNavigationGroup = (group: SettingsNavigationGroup) => {
    const visibleGroup = visibleNavigationGroups.find((candidate) => candidate.id === group.id);
    const targetSection = (deferredSearchQuery ? visibleGroup?.sections : group.sections)?.[0]?.id;
    if (!targetSection) return;
    setActiveGroupId(group.id);
    setActiveSection(targetSection);
    window.requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    });
  };

  const updateSetting = <K extends keyof DesktopSettings>(key: K, value: DesktopSettings[K]) => {
    setSettingsDraft((current) => (current ? { ...current, [key]: value } : current));
    void autoSaveSettings(key, value);
  };

  const authenticateRemoteServer = async () => {
    const serverUrl = settingsDraft?.remoteDirectServerUrl?.trim() || '';
    if (!serverUrl) {
      setRemoteAuthError('请先填写服务器地址。');
      return;
    }
    setRemoteAuthState('loading');
    setRemoteAuthError('');
    try {
      const next = await window.agentDesktop.authenticateRemoteServer({ serverUrl });
      setSettingsDraft(next);
      setRemoteAuthState('success');
      window.setTimeout(() => setRemoteAuthState('idle'), 2000);
    } catch (error) {
      const message = cleanIpcErrorMessage(error);
      if (message === '远端 Server 认证正在进行中。') {
        setRemoteAuthState('loading');
        setRemoteAuthError('');
        return;
      }
      setRemoteAuthState('idle');
      setRemoteAuthError(message === '认证已取消。' ? '' : message);
    }
  };

  const cancelRemoteServerAuthentication = async () => {
    try {
      await window.agentDesktop.cancelRemoteServerAuthentication();
    } finally {
      setRemoteAuthState('idle');
      setRemoteAuthError('');
    }
  };

  const updateImageSettings = (patch: Partial<DesktopSettings['image']>) => {
    const nextImage = {
      ...imageDraft,
      ...patch,
    };
    setSettingsDraft((current) => (current ? { ...current, image: nextImage } : current));
    void autoSaveImageSettings(nextImage);
  };

  const updateImageProvider = (provider: string) => {
    const previousDefaultUrl = IMAGE_PROVIDER_DEFAULT_URLS[imageDraft.provider ?? 'minimax'];
    const nextDefaultUrl = IMAGE_PROVIDER_DEFAULT_URLS[provider] ?? '';
    const previousDefaultModel = IMAGE_PROVIDER_DEFAULT_MODELS[imageDraft.provider ?? 'minimax'];
    const nextDefaultModel = IMAGE_PROVIDER_DEFAULT_MODELS[provider] ?? '';
    updateImageSettings({
      provider,
      url:
        !imageDraft.url || imageDraft.url === previousDefaultUrl
          ? nextDefaultUrl
          : imageDraft.url,
      model:
        !imageDraft.model || imageDraft.model === previousDefaultModel
          ? nextDefaultModel
          : imageDraft.model,
    });
  };

  const updateSessionMemorySettings = (patch: Partial<NonNullable<DesktopSettings['sessionMemory']>>) => {
    const nextSessionMemory = {
      ...sessionMemoryDraft,
      ...patch,
    };
    updateSetting('sessionMemory', nextSessionMemory);
  };

  const updateAutoMemorySettings = (patch: Partial<NonNullable<DesktopSettings['autoMemory']>>) => {
    updateSetting('autoMemory', {
      ...autoMemoryDraft,
      ...patch,
    });
  };

  const updateAdvancedSettings = (patch: Partial<NonNullable<DesktopSettings['advanced']>>) => {
    updateSetting('advanced', {
      ...advancedDraft,
      ...patch,
    });
  };

  const copyText = (value: string) => {
    if (!value) return;
    void navigator.clipboard.writeText(value);
  };

  if (!settingsDraft) {
    return (
      <div className="h-full overflow-auto p-6">
        <Surface className="p-8">
          <p className="text-sm font-medium text-foreground">正在读取设置…</p>
          <p className="mt-2 text-sm leading-7 text-muted-foreground">
            设置文件和当前主题配置加载后会显示完整的设置界面。
          </p>
        </Surface>
      </div>
    );
  }

  return (
    <div className="h-full overflow-hidden bg-sidebar/96 text-sidebar-foreground">
      <div className="flex h-full">
          <aside className="hidden h-full min-h-0 w-[232px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar/96 lg:flex">
            <div className="shrink-0 p-4 pb-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  className={cn(FIELD_CLASS_NAME, 'h-10 rounded-2xl pl-9')}
                  placeholder="搜索设置"
                />
              </div>
            </div>
            <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-4 pb-4 [scrollbar-gutter:stable]">
              {visibleNavigationGroups.map((group) => {
                const groupActive = group.id === activeGroupId;
                return (
                  <NavigationGroupButton
                    key={group.id}
                    group={group}
                    active={groupActive}
                    onClick={() => selectNavigationGroup(group)}
                  />
                );
              })}
            </nav>
          </aside>

          <div className="min-w-0 flex-1 overflow-hidden bg-sidebar/96">
            <div className="flex h-full flex-col">
              <div className="border-b border-sidebar-border bg-sidebar/96 px-4 py-4 lg:hidden">
                <div className="space-y-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                      className={cn(FIELD_CLASS_NAME, 'h-10 rounded-2xl pl-9')}
                      placeholder="搜索设置"
                    />
                  </div>
                  <div className="-mx-1 overflow-x-auto pb-1">
                    <div className="flex gap-2 px-1">
                      {visibleNavigationGroups.map((group) => (
                        <NavigationGroupButton
                          key={group.id}
                          group={group}
                          compact
                          active={group.id === activeGroupId}
                          onClick={() => selectNavigationGroup(group)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
                <div className="space-y-5 p-4 pb-10 sm:p-5 sm:pb-10 lg:p-6 lg:pb-12">
                  <div className="px-1">
                    <h1 className="text-2xl font-semibold tracking-normal text-foreground">
                      {deferredSearchQuery ? '搜索设置' : activeGroup.title}
                    </h1>
                  </div>

                  {settingsDraft.settingsParseError ? (
                    <Surface className="border-amber-200/80 bg-amber-50/90 p-4 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                      <div className="flex items-start gap-3">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">设置文件解析失败</p>
                          <p className="mt-1 text-xs leading-6 opacity-90">{settingsDraft.settingsParseError}</p>
                        </div>
                      </div>
                    </Surface>
                  ) : null}

                  {settingsNotice ? (
                    <Surface className="border-rose-200/80 bg-rose-50/90 p-4 text-rose-950 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-100">
                      <div className="flex items-start gap-3">
                        <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                        <div className="min-w-0">
                          <p className="text-sm font-medium">保存设置时发生错误</p>
                          <p className="mt-1 text-xs leading-6 opacity-90">{settingsNotice}</p>
                        </div>
                      </div>
                    </Surface>
                  ) : null}

                  {visibleSections.length === 0 ? (
                    <Surface className="p-6">
                      <p className="text-sm font-medium text-foreground">没有找到匹配的设置项</p>
                      <p className="mt-2 text-sm leading-7 text-muted-foreground">
                        当前搜索词没有命中任何分组，可以清空搜索后查看全部设置。
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        className="mt-4 rounded-xl"
                        onClick={() => setSearchQuery('')}
                      >
                        清空搜索
                      </Button>
                    </Surface>
                  ) : null}

                {visibleSections.some((section) => section.id === 'basic-info') ? (
                  <SettingsSection
                    id="basic-info"
                    title="基本信息"
                    sectionRef={(element) => {
                      sectionRefs.current['basic-info'] = element;
                    }}
                  >
                    <div className="mb-3 px-1 text-[13px] font-medium text-muted-foreground">
                      连接
                    </div>
                    <div className="space-y-3">
                      {/* 本地模式 */}
                      <SettingsGroup>
                        <SettingsRow
                          title="本地模式"
                          description="在本机运行 Agent，直接使用本地文本模型配置。"
                          controlClassName="sm:w-[56px]"
                        >
                          <div className="flex justify-start sm:justify-end">
                            <Toggle
                              checked={settingsDraft.localEnabled ?? true}
                              onCheckedChange={(checked) => {
                                updateSetting('localEnabled', checked);
                                if (!checked) {
                                  updateSetting('agentMode', 'remote-direct');
                                } else if (!(settingsDraft.remoteEnabled ?? false)) {
                                  updateSetting('agentMode', 'local');
                                }
                              }}
                              label="本地模式"
                            />
                          </div>
                        </SettingsRow>
                      </SettingsGroup>

                      {/* 云端模式 */}
                      <SettingsGroup>
                        <SettingsRow
                          title="云端模式"
                          description="连接到云端 Moss 服务器运行 Agent。"
                          controlClassName="sm:w-[56px]"
                        >
                          <div className="flex justify-start sm:justify-end">
                            <Toggle
                              checked={settingsDraft.remoteEnabled ?? false}
                              onCheckedChange={(checked) => {
                                updateSetting('remoteEnabled', checked);
                                if (!checked) {
                                  updateSetting('agentMode', 'local');
                                } else if (!(settingsDraft.localEnabled ?? true)) {
                                  updateSetting('agentMode', 'remote-direct');
                                }
                              }}
                              label="云端模式"
                            />
                          </div>
                        </SettingsRow>

                        {(settingsDraft.remoteEnabled ?? false) ? (
                          <>
                            <SettingsRow
                              title="服务器地址"
                              controlClassName="sm:w-[420px]"
                            >
                              <Input
                                className={FIELD_CLASS_NAME}
                                value={settingsDraft.remoteDirectServerUrl || ''}
                                disabled={remoteAuthState === 'loading'}
                                onChange={(event) => {
                                  setRemoteAuthState('idle');
                                  setRemoteAuthError('');
                                  updateSetting('remoteDirectServerUrl', event.target.value);
                                }}
                                placeholder="https://moss.example.com 或 http://127.0.0.1:43127"
                              />
                            </SettingsRow>

                            <SettingsRow
                              title="OAuth 认证"
                              description="通过浏览器登录 Moss Server，无需手动填写密码或 API Key。"
                              controlClassName="sm:w-[320px]"
                            >
                              <div className="space-y-2">
                                <div className="flex items-center justify-end gap-3">
                                  <span className="text-xs text-muted-foreground">
                                    {remoteAuthState === 'success' || settingsDraft.remoteDirectApiKey
                                      ? '已认证'
                                      : '未认证'}
                                  </span>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className="h-9 shrink-0 gap-2 rounded-lg px-3"
                                    onClick={() => {
                                      if (remoteAuthState === 'loading') {
                                        void cancelRemoteServerAuthentication();
                                      } else {
                                        void authenticateRemoteServer();
                                      }
                                    }}
                                  >
                                    {remoteAuthState === 'loading' ? (
                                      <X className="h-4 w-4" />
                                    ) : remoteAuthState === 'success' ? (
                                      <Check className="h-4 w-4" />
                                    ) : (
                                      <LogIn className="h-4 w-4" />
                                    )}
                                    {remoteAuthState === 'loading'
                                      ? '取消'
                                      : remoteAuthState === 'success' || settingsDraft.remoteDirectApiKey
                                        ? '重新认证'
                                        : '开始认证'}
                                  </Button>
                                </div>
                                {remoteAuthError ? (
                                  <p className="text-right text-xs text-destructive">{remoteAuthError}</p>
                                ) : null}
                              </div>
                            </SettingsRow>

                          </>
                        ) : null}
                      </SettingsGroup>
                    </div>

                    <div className="mb-3 mt-6 px-1 text-[13px] font-medium text-muted-foreground">
                      运行环境
                    </div>
                    <RuntimeSettings
                      settingsDraft={settingsDraft}
                      updateSetting={updateSetting}
                    />
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'permission') ? (
                  <SettingsSection
                    id="permission"
                    title="权限"
                    sectionRef={(element) => {
                      sectionRefs.current.permission = element;
                    }}
                  >
                    <SettingsGroup>
                      <SettingsRow
                        title="跳过常规权限确认"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(settingsDraft.bypassPermissions)}
                            onCheckedChange={(checked) => updateSetting('bypassPermissions', checked)}
                            label="跳过常规权限确认"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="实验性 Bash AST 权限解析"
                        description="使用结构化 Bash 解析器判定子命令、重定向和权限规则；复杂命令可能需要更多确认，新会话生效。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_bash_ast_permissions)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_bash_ast_permissions: checked })}
                            label="实验性 Bash AST 权限解析"
                          />
                        </div>
                      </SettingsRow>

                    </SettingsGroup>
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'agent-execution') ? (
                  <SettingsSection
                    id="agent-execution"
                    title="Agent 与执行"
                    sectionRef={(element) => {
                      sectionRefs.current['agent-execution'] = element;
                    }}
                  >
                    <SettingsGroup>
                      <SettingsRow
                        title="最大轮次"
                        controlClassName="sm:w-[112px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={10000}
                          className={FIELD_CLASS_NAME}
                          value={settingsDraft.maxTurns ?? 100}
                          onChange={(event) => {
                            const value = Number.parseInt(event.target.value || '1', 10);
                            updateSetting('maxTurns', value);
                          }}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="思考模式"
                        controlClassName="sm:w-[220px]"
                      >
                        <select
                          className={SELECT_CLASS_NAME}
                          value={settingsDraft.thinkingMode ?? 'disabled'}
                          onChange={(event) => {
                            updateSetting('thinkingMode', event.target.value as DesktopSettings['thinkingMode']);
                          }}
                        >
                          <option value="disabled">disabled (关闭)</option>
                          <option value="adaptive">adaptive (自动)</option>
                          <option value="enabled">enabled (强制开启)</option>
                          <option value="">default (保持手动配置)</option>
                        </select>
                      </SettingsRow>

                      {settingsDraft.thinkingMode === 'enabled' ? (
                        <SettingsRow
                          title="Thinking Budget Tokens"
                          description="只在强制开启思考模式时显示。"
                          controlClassName="sm:w-[180px]"
                        >
                          <Input
                            type="number"
                            min={1024}
                            max={128000}
                            className={FIELD_CLASS_NAME}
                            value={settingsDraft.thinkingBudgetTokens ?? 16000}
                            onChange={(event) => {
                              const value = Number.parseInt(event.target.value || '1024', 10);
                              updateSetting('thinkingBudgetTokens', value);
                            }}
                            placeholder="thinking budget tokens"
                          />
                        </SettingsRow>
                      ) : null}

                      <SettingsRow
                        title="长任务自动转后台"
                        description="前台 Agent 运行超过 120 秒后自动转为后台任务。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_auto_background_agents)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_auto_background_agents: checked })}
                            label="长任务自动转后台"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="独立验证 Agent"
                        description="让新会话在完成非简单实现前调用后台验证 Agent；会增加验证时间和模型调用成本。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_hive_evidence)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_hive_evidence: checked })}
                            label="独立验证 Agent"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="会话临时工作区"
                        description="为 Agent 和 Coordinator Worker 提供隔离的临时文件目录。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_scratchpad)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_scratchpad: checked })}
                            label="会话临时工作区"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="Plan 引导访谈"
                        description="Plan Mode 使用分阶段澄清、探索和计划生成流程。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_plan_mode_interview)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_plan_mode_interview: checked })}
                            label="Plan 引导访谈"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="快速网页搜索"
                        description="网页搜索使用小型快速模型并关闭 thinking，降低搜索延迟和成本。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_fast_web_search)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_fast_web_search: checked })}
                            label="快速网页搜索"
                          />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'tool-performance') ? (
                  <SettingsSection
                    id="tool-performance"
                    title="工具与性能"
                    sectionRef={(element) => {
                      sectionRefs.current['tool-performance'] = element;
                    }}
                  >
                    <SettingsGroup>
                      <SettingsRow
                        title="闲置会话优化"
                        description="会话闲置超过 60 分钟后清理较早的工具结果，降低恢复时的上下文开销。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_idle_session_cleanup)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_idle_session_cleanup: checked })}
                            label="闲置会话优化"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="流式工具执行"
                        description="工具参数生成完成后提前开始执行，减少多工具任务的等待时间。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_streaming_tool_execution)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_streaming_tool_execution: checked })}
                            label="流式工具执行"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="会话调试日志"
                        description="将新会话首轮发送给模型的 skill 提示等诊断信息写入 ~/.moss/logs/moss.log，便于按会话过滤排查。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_session_debug_logging)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_session_debug_logging: checked })}
                            label="会话调试日志"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="大型工具结果保护"
                        description="单轮工具结果过大时保存到会话目录，仅向模型提供预览和文件路径。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_large_tool_result_protection)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_large_tool_result_protection: checked })}
                            label="大型工具结果保护"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="单轮工具结果上限"
                        description="一轮中可直接发送给模型的工具结果字符数；超出的较大结果将保存到文件。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={10_000_000}
                          step={10_000}
                          disabled={!Boolean(advancedDraft.moss_large_tool_result_protection)}
                          className={FIELD_CLASS_NAME}
                          value={advancedDraft.moss_tool_result_budget_chars ?? DEFAULT_ADVANCED_SETTINGS.moss_tool_result_budget_chars}
                          onChange={(event) => updateAdvancedSettings({
                            moss_tool_result_budget_chars: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="MCP 输出 token 上限"
                        description="限制单次 MCP 工具结果发送给模型的 token 数，避免大型响应占满上下文。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={1_000_000}
                          step={1_000}
                          className={FIELD_CLASS_NAME}
                          value={advancedDraft.moss_mcp_output_token_limit ?? DEFAULT_ADVANCED_SETTINGS.moss_mcp_output_token_limit}
                          onChange={(event) => updateAdvancedSettings({
                            moss_mcp_output_token_limit: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="Read 文件大小上限"
                        description="Read 工具可直接读取的完整文件大小上限，单位为字节；超过后需按范围读取。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={1_000_000_000}
                          step={65_536}
                          className={FIELD_CLASS_NAME}
                          value={advancedDraft.moss_file_read_max_size_bytes ?? DEFAULT_ADVANCED_SETTINGS.moss_file_read_max_size_bytes}
                          onChange={(event) => updateAdvancedSettings({
                            moss_file_read_max_size_bytes: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="Read 输出 token 上限"
                        description="限制 Read 工具单次返回的内容 token 数，避免读取大文件占满上下文。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={1_000_000}
                          step={1_000}
                          className={FIELD_CLASS_NAME}
                          value={advancedDraft.moss_file_read_max_tokens ?? DEFAULT_ADVANCED_SETTINGS.moss_file_read_max_tokens}
                          onChange={(event) => updateAdvancedSettings({
                            moss_file_read_max_tokens: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>
                    </SettingsGroup>
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'memory') ? (
                  <SettingsSection
                    id="memory"
                    title="记忆"
                    sectionRef={(element) => {
                      sectionRefs.current.memory = element;
                    }}
                  >
                    <div className="mb-3 px-1 text-[13px] font-medium text-muted-foreground">
                      调优参数
                    </div>
                    <SettingsGroup>
                      <SettingsRow
                        title="初始化 token 阈值"
                        description="会话上下文达到该规模后，才开始创建 session-memory/summary.md。调小后更容易测试。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={1000000}
                          className={FIELD_CLASS_NAME}
                          value={sessionMemoryDraft.minimumMessageTokensToInit ?? DEFAULT_SESSION_MEMORY_SETTINGS.minimumMessageTokensToInit}
                          onChange={(event) => {
                            const value = Number.parseInt(event.target.value || '1', 10);
                            updateSessionMemorySettings({ minimumMessageTokensToInit: value });
                          }}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="更新 token 间隔"
                        description="距离上次提取新增的上下文 token 达到该值后，允许再次更新会话记忆。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={1000000}
                          className={FIELD_CLASS_NAME}
                          value={sessionMemoryDraft.minimumTokensBetweenUpdate ?? DEFAULT_SESSION_MEMORY_SETTINGS.minimumTokensBetweenUpdate}
                          onChange={(event) => {
                            const value = Number.parseInt(event.target.value || '1', 10);
                            updateSessionMemorySettings({ minimumTokensBetweenUpdate: value });
                          }}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="工具调用间隔"
                        description="两次会话记忆更新之间至少需要的工具调用次数。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={10000}
                          className={FIELD_CLASS_NAME}
                          value={sessionMemoryDraft.toolCallsBetweenUpdates ?? DEFAULT_SESSION_MEMORY_SETTINGS.toolCallsBetweenUpdates}
                          onChange={(event) => {
                            const value = Number.parseInt(event.target.value || '1', 10);
                            updateSessionMemorySettings({ toolCallsBetweenUpdates: value });
                          }}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="压缩保留 token 下限"
                        description="使用会话记忆压缩时，至少保留的近期上下文 token 数。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={1000000}
                          className={FIELD_CLASS_NAME}
                          value={sessionMemoryDraft.compactMinTokens ?? DEFAULT_SESSION_MEMORY_SETTINGS.compactMinTokens}
                          onChange={(event) => updateSessionMemorySettings({
                            compactMinTokens: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="压缩保留消息下限"
                        description="使用会话记忆压缩时，至少保留的近期文本消息数。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={10000}
                          className={FIELD_CLASS_NAME}
                          value={sessionMemoryDraft.compactMinTextBlockMessages ?? DEFAULT_SESSION_MEMORY_SETTINGS.compactMinTextBlockMessages}
                          onChange={(event) => updateSessionMemorySettings({
                            compactMinTextBlockMessages: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="压缩保留 token 上限"
                        description="使用会话记忆压缩时，近期上下文最多保留的 token 数。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={1000000}
                          className={FIELD_CLASS_NAME}
                          value={sessionMemoryDraft.compactMaxTokens ?? DEFAULT_SESSION_MEMORY_SETTINGS.compactMaxTokens}
                          onChange={(event) => updateSessionMemorySettings({
                            compactMaxTokens: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="历史上下文搜索"
                        description="允许 Agent 在需要时搜索长期记忆和当前会话的历史记录。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(autoMemoryDraft.pastContextSearchEnabled)}
                            onCheckedChange={(checked) => updateAutoMemorySettings({ pastContextSearchEnabled: checked })}
                            label="历史上下文搜索"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="从纠正中学习"
                        description="拒绝或取消工具操作后，提醒 Agent 识别后续纠正和偏好并考虑写入长期记忆。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_memory_learn_from_corrections)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_memory_learn_from_corrections: checked })}
                            label="从纠正中学习"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="提取间隔"
                        description="每累计多少轮会话执行一次自动提取。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={10000}
                          className={FIELD_CLASS_NAME}
                          value={autoMemoryDraft.extractionIntervalTurns ?? DEFAULT_AUTO_MEMORY_SETTINGS.extractionIntervalTurns}
                          onChange={(event) => updateAutoMemorySettings({
                            extractionIntervalTurns: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="Dream 最短间隔"
                        description="两次后台整理之间至少间隔的小时数。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={0.1}
                          max={8760}
                          step={0.5}
                          className={FIELD_CLASS_NAME}
                          value={autoMemoryDraft.dreamMinHours ?? DEFAULT_AUTO_MEMORY_SETTINGS.dreamMinHours}
                          onChange={(event) => updateAutoMemorySettings({
                            dreamMinHours: Number(event.target.value || '0.1'),
                          })}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="Dream 最少会话数"
                        description="上次整理后至少有多少个其他会话活跃，才允许再次整理。"
                        controlClassName="sm:w-[160px]"
                      >
                        <Input
                          type="number"
                          min={1}
                          max={100000}
                          className={FIELD_CLASS_NAME}
                          value={autoMemoryDraft.dreamMinSessions ?? DEFAULT_AUTO_MEMORY_SETTINGS.dreamMinSessions}
                          onChange={(event) => updateAutoMemorySettings({
                            dreamMinSessions: Number.parseInt(event.target.value || '1', 10),
                          })}
                        />
                      </SettingsRow>
                    </SettingsGroup>
                    <div className="mb-3 mt-6 px-1 text-[13px] font-medium text-muted-foreground">
                      基础设置
                    </div>
                    <SettingsGroup>
                      <SettingsRow
                        title="上下文压缩策略"
                        description="主动压缩更稳定；响应式压缩会尽量使用完整上下文，仅在接口返回超限后恢复。"
                        controlClassName="sm:w-[220px]"
                      >
                        <select
                          className={SELECT_CLASS_NAME}
                          value={advancedDraft.moss_context_compaction_strategy ?? DEFAULT_ADVANCED_SETTINGS.moss_context_compaction_strategy}
                          onChange={(event) => updateAdvancedSettings({
                            moss_context_compaction_strategy: event.target.value as 'proactive' | 'reactive',
                          })}
                        >
                          <option value="proactive">主动压缩（推荐）</option>
                          <option value="reactive">超限后压缩</option>
                        </select>
                      </SettingsRow>

                      <SettingsRow
                        title="会话记忆"
                        description="为每个会话维护独立摘要，用于长会话压缩和恢复当前上下文。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(sessionMemoryDraft.enabled)}
                            onCheckedChange={(checked) => updateSessionMemorySettings({ enabled: checked })}
                            label="会话记忆"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="压缩时使用会话记忆"
                        description="开启后，/compact 和自动压缩会优先使用当前会话摘要。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(sessionMemoryDraft.compactEnabled)}
                            onCheckedChange={(checked) => updateSessionMemorySettings({ compactEnabled: checked })}
                            label="压缩时使用会话记忆"
                          />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>

                    <div className="mb-3 mt-6 px-1 text-[13px] font-medium text-muted-foreground">
                      长期记忆
                    </div>
                    <SettingsGroup>
                      <SettingsRow
                        title="长期记忆"
                        description="在本地或用户 profile 中保存可跨会话使用的记忆。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(autoMemoryDraft.enabled)}
                            onCheckedChange={(checked) => updateAutoMemorySettings({ enabled: checked })}
                            label="长期记忆"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="自动提取"
                        description="每轮结束后从新增对话中提取值得长期保留的信息。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(autoMemoryDraft.extractionEnabled)}
                            onCheckedChange={(checked) => updateAutoMemorySettings({ extractionEnabled: checked })}
                            label="自动提取长期记忆"
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="Dream 整理"
                        description="达到时间和会话门槛后，在后台合并、修正和精简长期记忆。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(autoMemoryDraft.dreamEnabled)}
                            onCheckedChange={(checked) => updateAutoMemorySettings({ dreamEnabled: checked })}
                            label="Dream 整理"
                          />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'mcp') ? (
                  <SettingsSection
                    id="mcp"
                    title="MCP"
                    sectionRef={(element) => {
                      sectionRefs.current.mcp = element;
                    }}
                  >
                    <McpSettings />
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'service-address') ? (
                  <SettingsSection
                    id="service-address"
                    title="服务地址"
                    sectionRef={(element) => {
                      sectionRefs.current['service-address'] = element;
                    }}
                  >
                    <div className="mb-3 px-1 text-[13px] font-medium text-muted-foreground">
                      SkillHub
                    </div>
                    <SettingsGroup>
                      <SettingsRow
                        title="API 地址"
                        controlClassName="sm:w-[360px]"
                      >
                        <Input
                          className={FIELD_CLASS_NAME}
                          value={settingsDraft.skillHub?.apiBaseUrl || 'https://api.skillhub.cn'}
                          onChange={(event) => {
                            updateSetting('skillHub', {
                              ...(settingsDraft.skillHub || {}),
                              apiBaseUrl: event.target.value,
                            });
                          }}
                          placeholder="https://api.skillhub.cn"
                        />
                      </SettingsRow>
                    </SettingsGroup>

                    <div className="mb-3 mt-6 px-1 text-[13px] font-medium text-muted-foreground">
                      专家中心
                    </div>
                    <SettingsGroup>
                      <SettingsRow
                        title="根地址"
                        controlClassName="sm:w-[520px]"
                      >
                        <Input
                          className={FIELD_CLASS_NAME}
                          value={settingsDraft.expertHub?.baseUrl || 'https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace'}
                          onChange={(event) => {
                            updateSetting('expertHub', {
                              ...(settingsDraft.expertHub || {}),
                              baseUrl: event.target.value,
                            });
                          }}
                          placeholder="https://acc-1258344699.cos.accelerate.myqcloud.com/workbuddy/expert-marketplace"
                        />
                      </SettingsRow>
                    </SettingsGroup>
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'model') ? (
                  <SettingsSection
                    id="model"
                    title="模型"
                    sectionRef={(element) => {
                      sectionRefs.current.model = element;
                    }}
                  >
                    <div className="mb-3 px-1 text-[13px] font-medium text-muted-foreground">
                      文本模型
                    </div>
                    <SettingsGroup>
                      <SettingsRow
                        title="默认模型"
                        controlClassName="sm:w-[280px]"
                      >
                        <Input
                          className={FIELD_CLASS_NAME}
                          value={settingsDraft.model || ''}
                          onChange={(event) => updateSetting('model', event.target.value)}
                          placeholder="your-model-name"
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="API URL"
                        controlClassName="sm:w-[380px]"
                      >
                        <Input
                          className={FIELD_CLASS_NAME}
                          value={settingsDraft.url || ''}
                          onChange={(event) => updateSetting('url', event.target.value)}
                          placeholder="https://model.example.com"
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="API Key"
                        controlClassName="sm:w-[380px]"
                      >
                        <div className="flex w-full gap-2">
                          <Input
                            className={cn(FIELD_CLASS_NAME, 'font-mono text-xs')}
                            value={settingsDraft.apiKey || ''}
                            onChange={(event) => updateSetting('apiKey', event.target.value)}
                            placeholder="your-model-api-key"
                          />
                          {settingsDraft.apiKey ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-xl border-black/10 bg-white/90 px-3 dark:border-white/10 dark:bg-background/75"
                              onClick={() => copyText(settingsDraft.apiKey || '')}
                            >
                              复制
                            </Button>
                          ) : null}
                        </div>
                      </SettingsRow>
                    </SettingsGroup>

                    <div className="mb-3 mt-6 px-1 text-[13px] font-medium text-muted-foreground">
                      图片模型
                    </div>
                    <SettingsGroup>
                      <SettingsRow
                        title="图片厂商"
                        controlClassName="sm:w-[180px]"
                      >
                        <select
                          className={SELECT_CLASS_NAME}
                          value={imageDraft.provider ?? 'minimax'}
                          onChange={(event) => updateImageProvider(event.target.value)}
                        >
                          <option value="minimax">MiniMax</option>
                          <option value="openai">OpenAI</option>
                        </select>
                      </SettingsRow>

                      <SettingsRow
                        title="API URL"
                        controlClassName="sm:w-[380px]"
                      >
                        <Input
                          className={FIELD_CLASS_NAME}
                          value={imageDraft.url || ''}
                          onChange={(event) => updateImageSettings({ url: event.target.value })}
                          placeholder={IMAGE_PROVIDER_DEFAULT_URLS[imageDraft.provider ?? 'minimax'] ?? 'https://api.openai.com/v1'}
                        />
                      </SettingsRow>

                      <SettingsRow
                        title="API Key"
                        controlClassName="sm:w-[380px]"
                      >
                        <div className="flex w-full gap-2">
                          <Input
                            type="password"
                            className={cn(FIELD_CLASS_NAME, 'font-mono text-xs')}
                            value={imageDraft.apiKey || ''}
                            onChange={(event) => updateImageSettings({ apiKey: event.target.value })}
                            placeholder="sk-..."
                          />
                          {imageDraft.apiKey ? (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-9 rounded-xl border-black/10 bg-white/90 px-3 dark:border-white/10 dark:bg-background/75"
                              onClick={() => copyText(imageDraft.apiKey || '')}
                            >
                              复制
                            </Button>
                          ) : null}
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="图片模型"
                        controlClassName="sm:w-[280px]"
                      >
                        <Input
                          className={FIELD_CLASS_NAME}
                          value={imageDraft.model || ''}
                          onChange={(event) => updateImageSettings({ model: event.target.value })}
                          placeholder={IMAGE_PROVIDER_DEFAULT_MODELS[imageDraft.provider ?? 'minimax'] ?? 'gpt-image-1'}
                        />
                      </SettingsRow>
                    </SettingsGroup>
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'prompt') ? (
                  <SettingsSection
                    id="prompt"
                    title="系统提示"
                    sectionRef={(element) => {
                      sectionRefs.current.prompt = element;
                    }}
                  >
                    <Surface className="p-0">
                      <SettingsRow
                        title="追加系统提示"
                        stacked
                      >
                        <Textarea
                          className={cn(
                            'min-h-[180px] rounded-[18px] border-black/10 bg-[#fafafc] text-[13px] shadow-none dark:border-white/10 dark:bg-background/[0.55]',
                          )}
                          value={settingsDraft.appendSystemPrompt || ''}
                          onChange={(event) => updateSetting('appendSystemPrompt', event.target.value)}
                          placeholder="例如：默认使用中文回复；修改代码前先解释关键影响；避免自动删除用户未要求的文件。"
                        />
                      </SettingsRow>
                    </Surface>
                    <SettingsGroup className="mt-3">
                      <SettingsRow
                        title="发送请求归因信息"
                        description="在系统提示中附带版本、入口和 workload 信息；关闭可提高自定义接口兼容性。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={Boolean(advancedDraft.moss_request_attribution_enabled)}
                            onCheckedChange={(checked) => updateAdvancedSettings({ moss_request_attribution_enabled: checked })}
                            label="发送请求归因信息"
                          />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'feishu') ? (
                  <SettingsSection
                    id="feishu"
                    title="飞书"
                    sectionRef={(element) => {
                      sectionRefs.current.feishu = element;
                    }}
                  >
                    <FeishuSettings />
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'buddy') ? (
                  <SettingsSection
                    id="buddy"
                    title="Buddy"
                    sectionRef={(element) => {
                      sectionRefs.current.buddy = element;
                    }}
                  >
                    <SettingsGroup>
                      <SettingsRow
                        title="Buddy 伴侣精灵"
                        description="开启后在侧边栏显示你的专属宠物陪伴。"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={buddyEnabled}
                            onCheckedChange={onBuddyEnabledChange}
                            label="启用 Buddy 伴侣精灵"
                          />
                        </div>
                      </SettingsRow>

                      {buddyEnabled ? (
                        <SettingsRow
                          title="Buddy 状态"
                          description="在这里孵化、查看和编辑当前的陪伴精灵。"
                          stacked
                        >
                          <BuddySummary />
                        </SettingsRow>
                      ) : (
                        <div className="px-4 py-4">
                          <div className="rounded-[18px] border border-dashed border-black/10 bg-[#fafafc] px-4 py-3 text-xs leading-6 text-muted-foreground dark:border-white/10 dark:bg-background/[0.35]">
                            Buddy 已关闭。重新开启后，侧边栏会恢复显示宠物陪伴。
                          </div>
                        </div>
                      )}
                    </SettingsGroup>
                  </SettingsSection>
                ) : null}

                {visibleSections.some((section) => section.id === 'appearance') ? (
                  <SettingsSection
                    id="appearance"
                    title="外观"
                    sectionRef={(element) => {
                      sectionRefs.current.appearance = element;
                    }}
                  >
                    <SettingsGroup>
                      <SettingsRow
                        title="主题"
                        description="选择浅色、暗色或跟随系统的主题模式。"
                        stacked
                      >
                        <div className="flex flex-col gap-3 sm:flex-row">
                          <ThemeModeButton
                            active={themeMode === 'light'}
                            icon={SunMedium}
                            label="浅色"
                            onClick={() => setThemeMode('light')}
                          />
                          <ThemeModeButton
                            active={themeMode === 'system'}
                            icon={Monitor}
                            label="跟随系统"
                            onClick={() => setThemeMode('system')}
                          />
                          <ThemeModeButton
                            active={themeMode === 'dark'}
                            icon={MoonStar}
                            label="暗色"
                            onClick={() => setThemeMode('dark')}
                          />
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="背景样式"
                        description="选择预设的背景纹理或渐变。"
                        stacked
                      >
                        <div className="flex flex-wrap gap-3">
                          {PRESET_THEMES.map((theme) => (
                            <ThemePresetButton
                              key={theme.id}
                              selected={cssThemeId === theme.id}
                              themeId={theme.id}
                              themeName={theme.name}
                              onClick={() => setCssThemeId(theme.id)}
                            />
                          ))}
                        </div>
                      </SettingsRow>

                      <SettingsRow
                        title="自动折叠工具调用"
                        controlClassName="sm:w-[56px]"
                      >
                        <div className="flex justify-start sm:justify-end">
                          <Toggle
                            checked={settingsDraft.appearance.autoCollapseToolCalls ?? false}
                            onCheckedChange={onAutoCollapseToolCallsChange}
                            label="自动折叠工具调用"
                          />
                        </div>
                      </SettingsRow>
                    </SettingsGroup>
                  </SettingsSection>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function FeishuSettings() {
  const { config, isLoading, fetchConfig, updateConfig, applyRunLocation, generatePairingCode, removePairedUser } = useAdapterConfig()

  const [fsAppId, setFsAppId] = React.useState('')
  const [fsAppSecret, setFsAppSecret] = React.useState('')
  const [fsEncryptKey, setFsEncryptKey] = React.useState('')
  const [fsVerificationToken, setFsVerificationToken] = React.useState('')
  const [fsAllowedUsers, setFsAllowedUsers] = React.useState('')
  const [fsStreamingCard, setFsStreamingCard] = React.useState(false)
  const [fsRunLocation, setFsRunLocation] = React.useState<'desktop' | 'server'>('desktop')
  const [isSaving, setIsSaving] = React.useState(false)
  const [isApplyingLocation, setIsApplyingLocation] = React.useState(false)
  const [applyLocationError, setApplyLocationError] = React.useState('')
  const [saveStatus, setSaveStatus] = React.useState<'idle' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = React.useState('')
  const [pairingCode, setPairingCode] = React.useState<string | null>(null)
  const [isGenerating, setIsGenerating] = React.useState(false)
  const [pendingUnbind, setPendingUnbind] = React.useState<{ userId: string | number } | null>(null)
  const [isUnbinding, setIsUnbinding] = React.useState(false)
  const hasHydratedForm = React.useRef(false)
  const [feishuStatus, setFeishuStatus] = React.useState<FeishuAdapterStatus>({
    status: 'stopped',
    pid: null,
    bridgeReady: false,
    transportConnected: false,
    location: 'desktop',
  })

  React.useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  React.useEffect(() => {
    const unsubscribe = window.agentDesktop.onAdapterStatus(setFeishuStatus)
    const refresh = () => {
      void window.agentDesktop.getAdapterStatus()
        .then((status) => {
          setFeishuStatus(status)
        })
        .catch(() => {})
    }
    refresh()
    const timer = window.setInterval(refresh, 5_000)
    return () => {
      window.clearInterval(timer)
      unsubscribe()
    }
  }, [])

  React.useEffect(() => {
    if (feishuStatus.pairing && !feishuStatus.pairing.code) setPairingCode(null)
  }, [feishuStatus.pairing])

  React.useEffect(() => {
    if (isLoading || hasHydratedForm.current) return
    setFsAppId(config.feishu?.appId ?? '')
    setFsAppSecret(config.feishu?.appSecret ?? '')
    setFsEncryptKey(config.feishu?.encryptKey ?? '')
    setFsVerificationToken(config.feishu?.verificationToken ?? '')
    setFsAllowedUsers(config.feishu?.allowedUsers?.join(', ') ?? '')
    setFsStreamingCard(config.feishu?.streamingCard ?? false)
    setFsRunLocation(config.feishu?.runLocation === 'server' ? 'server' : 'desktop')
    hasHydratedForm.current = true
  }, [config, isLoading])

  async function handleSave() {
    setIsSaving(true)
    setSaveStatus('idle')
    setSaveError('')
    try {
      const fsUsers = fsAllowedUsers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      await updateConfig({
        feishu: {
          appId: fsAppId || undefined,
          appSecret: fsAppSecret || undefined,
          encryptKey: fsEncryptKey || undefined,
          verificationToken: fsVerificationToken || undefined,
          allowedUsers: fsUsers.length ? fsUsers : [],
          streamingCard: fsStreamingCard,
        },
      })
      setFeishuStatus(await window.agentDesktop.getAdapterStatus())
      setSaveStatus('saved')
      setTimeout(() => setSaveStatus('idle'), 2000)
    } catch (err) {
      setSaveStatus('error')
      setSaveError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setIsSaving(false)
    }
  }

  const handleApplyRunLocation = async () => {
    setIsApplyingLocation(true)
    setApplyLocationError('')
    try {
      const result = await applyRunLocation(fsRunLocation)
      setFeishuStatus(result.status)
    } catch (err) {
      setApplyLocationError(err instanceof Error ? err.message : '切换运行位置失败')
      void window.agentDesktop.getAdapterStatus().then(setFeishuStatus).catch(() => {})
    } finally {
      setIsApplyingLocation(false)
    }
  }

  const handleGenerateCode = async () => {
    setIsGenerating(true)
    try {
      const code = await generatePairingCode()
      setPairingCode(code)
      setFeishuStatus(await window.agentDesktop.getAdapterStatus())
    } catch (err) {
      console.error('Failed to generate pairing code:', err)
    } finally {
      setIsGenerating(false)
    }
  }

  const handleUnbind = async () => {
    if (!pendingUnbind) return
    setIsUnbinding(true)
    try {
      await removePairedUser(pendingUnbind.userId)
      setFeishuStatus(await window.agentDesktop.getAdapterStatus())
      setPendingUnbind(null)
    } finally {
      setIsUnbinding(false)
    }
  }

  const allPairedUsers = feishuStatus.enabled === false
    ? config.feishu?.pairedUsers ?? []
    : feishuStatus.pairedUsers ?? config.feishu?.pairedUsers ?? []

  const pairingState = feishuStatus.enabled === false
    ? config.pairing
    : feishuStatus.pairing ?? config.pairing
  const pairingExpiry = pairingState?.expiresAt
  const isPairingActive = pairingExpiry ? Date.now() < pairingExpiry : false
  const minutesLeft = pairingExpiry ? Math.max(0, Math.ceil((pairingExpiry - Date.now()) / 60000)) : 0
  const appliedRunLocation = config.feishu?.runLocation === 'server' ? 'server' : 'desktop'
  const hasPendingRunLocation = fsRunLocation !== appliedRunLocation

  if (isLoading) {
    return (
      <Surface className="p-6">
        <p className="text-sm font-medium text-foreground">正在加载飞书配置…</p>
      </Surface>
    )
  }

  return (
    <div className="space-y-5">
      <Surface>
        <div className="border-b border-sidebar-border bg-sidebar-accent/58 px-4 py-2.5 text-[13px] font-medium text-foreground">
          飞书
        </div>

        <div className="space-y-3 p-4">
          <div className="flex flex-col gap-2 border-b border-sidebar-border pb-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[13px] font-medium text-foreground">运行位置</p>
              <p className="mt-0.5 text-xs text-muted-foreground">同一时间只运行一个飞书实例</p>
            </div>
            <div className="flex flex-col items-stretch gap-2 sm:items-end">
              <div className="grid grid-cols-2 rounded-md border border-sidebar-border bg-sidebar p-0.5">
                <button
                  type="button"
                  onClick={() => setFsRunLocation('desktop')}
                  disabled={isApplyingLocation}
                  className={cn(
                    'flex h-8 items-center justify-center gap-1.5 rounded px-3 text-xs transition-colors',
                    fsRunLocation === 'desktop' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Monitor className="h-3.5 w-3.5" />
                  本机
                </button>
                <button
                  type="button"
                  onClick={() => setFsRunLocation('server')}
                  disabled={isApplyingLocation}
                  className={cn(
                    'flex h-8 items-center justify-center gap-1.5 rounded px-3 text-xs transition-colors',
                    fsRunLocation === 'server' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Server className="h-3.5 w-3.5" />
                  Moss Server
                </button>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">
                  当前：{appliedRunLocation === 'server' ? 'Moss Server' : '本机'}
                  {hasPendingRunLocation ? ' · 待应用' : ''}
                </span>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleApplyRunLocation}
                  disabled={!hasPendingRunLocation || isApplyingLocation || isSaving}
                  className="rounded-md"
                >
                  {isApplyingLocation ? '切换中…' : hasPendingRunLocation ? '应用切换' : '已应用'}
                </Button>
              </div>
              {applyLocationError ? (
                <p className="max-w-[420px] text-right text-xs text-destructive">{applyLocationError}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-2 border-b border-sidebar-border pb-3 text-xs text-muted-foreground">
            <span className={cn(
              'h-2 w-2 rounded-full',
              feishuStatus.transportConnected
                ? 'bg-emerald-500'
                : feishuStatus.status === 'running' ? 'bg-amber-500' : 'bg-muted-foreground/45',
            )} />
            <span className="min-w-0 break-words">
              {feishuStatus.transportConnected
                ? `${feishuStatus.location === 'server' ? 'Moss Server' : '本机'}飞书长连接已就绪`
                : feishuStatus.bridgeReady
                  ? `${feishuStatus.location === 'server' ? 'Server' : '客户端'}桥接已连接，正在等待飞书长连接`
                  : feishuStatus.status === 'error'
                    ? `Adapter 启动失败：${feishuStatus.error || '未知错误'}`
                  : feishuStatus.status === 'running'
                    ? 'Adapter 正在启动'
                    : feishuStatus.status === 'disabled'
                      ? 'Adapter 未配置'
                      : 'Adapter 未启动'}
            </span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">App ID</label>
              <Input className={FIELD_CLASS_NAME} value={fsAppId} onChange={(e) => setFsAppId(e.target.value)} placeholder="cli_xxxxxxxx" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">App Secret</label>
              <Input type="password" className={FIELD_CLASS_NAME} value={fsAppSecret} onChange={(e) => setFsAppSecret(e.target.value)} placeholder="****" />
            </div>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Encrypt Key</label>
              <Input type="password" className={FIELD_CLASS_NAME} value={fsEncryptKey} onChange={(e) => setFsEncryptKey(e.target.value)} placeholder="****" />
            </div>
            <div className="space-y-1.5">
              <label className="text-[13px] font-medium text-foreground">Verification Token</label>
              <Input type="password" className={FIELD_CLASS_NAME} value={fsVerificationToken} onChange={(e) => setFsVerificationToken(e.target.value)} placeholder="****" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[13px] font-medium text-foreground">允许的用户 ID</label>
            <Input className={FIELD_CLASS_NAME} value={fsAllowedUsers} onChange={(e) => setFsAllowedUsers(e.target.value)} placeholder="ou_xxx, ou_yyy（可选白名单，逗号分隔）" />
          </div>
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={fsStreamingCard}
              onChange={(e) => setFsStreamingCard(e.target.checked)}
              className="h-4 w-4 rounded border-sidebar-border accent-primary"
            />
            <div>
              <span className="text-[13px] font-medium text-foreground">流式卡片</span>
              <p className="text-xs text-muted-foreground">开启后，飞书消息流式更新（需要应用支持）</p>
            </div>
          </label>
        </div>

        <div className="border-t border-sidebar-border">
          <div className="flex items-center gap-2 bg-sidebar-accent/35 px-4 py-3">
            <MessageSquare className="h-4 w-4 text-muted-foreground" />
            <span className="text-[13px] font-medium text-foreground">配对管理</span>
          </div>
          <div className="space-y-4 px-4 pb-4">
            <p className="text-xs leading-6 text-muted-foreground">生成配对码后，在飞书机器人中输入该码即可绑定账号。</p>

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={handleGenerateCode} disabled={isGenerating}>
                {pairingCode || isPairingActive ? '重新生成' : '生成配对码'}
              </Button>
              {pairingCode && isPairingActive && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-2xl font-bold tracking-[0.3em] text-primary">{pairingCode}</span>
                  <span className="text-xs text-muted-foreground">60 分钟内有效</span>
                </div>
              )}
              {!pairingCode && isPairingActive && (
                <span className="text-xs text-muted-foreground">{minutesLeft} 分钟后过期</span>
              )}
            </div>

            <div>
              <p className="mb-2 text-[13px] font-medium text-foreground">已配对用户</p>
              {allPairedUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground">暂无已配对用户</p>
              ) : (
                <div className="space-y-2">
                  {allPairedUsers.map((user) => (
                    <div
                      key={String(user.userId)}
                      className="flex items-center justify-between gap-3 rounded-md border border-sidebar-border bg-sidebar-accent/70 px-3 py-2"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="rounded bg-sidebar px-1.5 py-0.5 text-[11px] text-muted-foreground">飞书</span>
                        <span className="min-w-0 break-all text-[13px] text-foreground">{user.displayName}</span>
                        <span className="text-xs text-muted-foreground">{new Date(user.pairedAt).toLocaleDateString()}</span>
                      </div>
                      <button
                        onClick={() => setPendingUnbind({ userId: user.userId })}
                        className="shrink-0 text-xs text-destructive hover:underline"
                      >
                        解绑
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </Surface>

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={isSaving || isApplyingLocation} className="rounded-xl">
          {isSaving ? '保存中…' : saveStatus === 'saved' ? '已保存 ✓' : '保存配置'}
        </Button>
        {saveStatus === 'error' && (
          <span className="text-sm text-destructive">{saveError}</span>
        )}
      </div>

      {/* Unbind confirm */}
      {pendingUnbind && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => { if (!isUnbinding) setPendingUnbind(null) }}>
          <div className="w-[360px] rounded-[20px] bg-background p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <p className="text-[13px] font-medium text-foreground">确认解绑</p>
            <p className="mt-2 text-xs text-muted-foreground">确定要解绑该用户吗？解绑后该用户将无法再通过飞书与 Agent 对话。</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="outline" size="sm" className="rounded-xl" onClick={() => setPendingUnbind(null)} disabled={isUnbinding}>取消</Button>
              <Button size="sm" className="rounded-xl bg-destructive text-white hover:bg-destructive/90" onClick={handleUnbind} disabled={isUnbinding}>
                {isUnbinding ? '解绑中…' : '解绑'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
