import * as React from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Clock3,
  Inbox,
  Loader2,
  Mail,
  RefreshCw,
  Reply,
  Search,
  Send,
  Settings,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import type { AgentMailMessage } from '@/types';

type MailboxDirection = 'inbox' | 'outbox';

type AgentMailViewProps = {
  enabled: boolean;
  onOpenSettings: () => void;
};

type DateGroup = {
  key: string;
  label: string;
  messages: AgentMailMessage[];
};

const STATUS_LABELS: Record<AgentMailMessage['status'], string> = {
  queued: '待投递',
  leased: '投递中',
  accepted: '已接收',
  running: '执行中',
  completed: '已完成',
  failed: '失败',
  expired: '已过期',
};

function formatRowDate(value: number) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
  }).format(value);
}

function formatFullDate(value: number | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(value);
}

function localDay(value: number) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

function dateGroupKey(value: number) {
  const date = localDay(value);
  return [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-');
}

function dateGroupLabel(value: number, now = Date.now()) {
  const date = localDay(value);
  const today = localDay(now);
  const difference = Math.round((today.getTime() - date.getTime()) / 86_400_000);
  if (difference === 0) return '今天';
  if (difference === 1) return '昨天';
  if (date.getFullYear() === today.getFullYear()) {
    return String(date.getMonth() + 1) + '月' + String(date.getDate()) + '日';
  }
  return String(date.getFullYear()) + '年' + String(date.getMonth() + 1) + '月' + String(date.getDate()) + '日';
}

export function groupAgentMailByDate(messages: AgentMailMessage[], now = Date.now()): DateGroup[] {
  const groups = new Map<string, DateGroup>();
  for (const message of messages) {
    const key = dateGroupKey(message.createdAt);
    const existing = groups.get(key);
    if (existing) {
      existing.messages.push(message);
    } else {
      groups.set(key, {
        key,
        label: dateGroupLabel(message.createdAt, now),
        messages: [message],
      });
    }
  }
  return [...groups.values()];
}

function statusTone(status: AgentMailMessage['status']) {
  if (status === 'completed') return 'text-emerald-600 dark:text-emerald-400';
  if (status === 'failed' || status === 'expired') return 'text-destructive';
  if (status === 'running' || status === 'accepted') return 'text-primary';
  return 'text-muted-foreground';
}

function counterpart(message: AgentMailMessage, direction: MailboxDirection) {
  if (direction === 'outbox') {
    return message.toName || message.toUserId || '未知收件人';
  }
  return message.fromName || message.fromUserId || '未知发件人';
}

function messageMatches(message: AgentMailMessage, query: string) {
  if (!query) return true;
  const haystack = [
    message.subject,
    message.content,
    message.fromName,
    message.fromUserId,
    message.toName,
    message.toUserId,
  ].join('\n').toLocaleLowerCase();
  return haystack.includes(query.toLocaleLowerCase());
}

function MailStatus({ message, compact = false }: { message: AgentMailMessage; compact?: boolean }) {
  const StatusIcon = message.status === 'completed'
    ? CheckCircle2
    : message.status === 'failed' || message.status === 'expired'
      ? AlertCircle
      : Clock3;
  return (
    <span
      className={cn('inline-flex shrink-0 items-center gap-1 text-[11px]', statusTone(message.status))}
      title={STATUS_LABELS[message.status]}
    >
      <StatusIcon className="h-3.5 w-3.5" />
      {compact ? null : STATUS_LABELS[message.status]}
    </span>
  );
}

export function AgentMailView({ enabled, onOpenSettings }: AgentMailViewProps) {
  const [direction, setDirection] = React.useState<MailboxDirection>('inbox');
  const [mailboxes, setMailboxes] = React.useState<Record<MailboxDirection, AgentMailMessage[]>>({
    inbox: [],
    outbox: [],
  });
  const [selectedMessageId, setSelectedMessageId] = React.useState<string | null>(null);
  const [selectedIds, setSelectedIds] = React.useState<Set<string>>(() => new Set());
  const [query, setQuery] = React.useState('');
  const [loading, setLoading] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [error, setError] = React.useState('');

  const load = React.useCallback(async () => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [inboxResult, outboxResult] = await Promise.allSettled([
        window.agentDesktop.agentMail.list('inbox', 100),
        window.agentDesktop.agentMail.list('outbox', 100),
      ]);
      setMailboxes((current) => ({
        inbox: inboxResult.status === 'fulfilled' && Array.isArray(inboxResult.value.messages)
          ? inboxResult.value.messages
          : current.inbox,
        outbox: outboxResult.status === 'fulfilled' && Array.isArray(outboxResult.value.messages)
          ? outboxResult.value.messages
          : current.outbox,
      }));
      const failures = [
        ['收信记录', inboxResult],
        ['发信记录', outboxResult],
      ].flatMap(([label, result]) => {
        if (typeof result !== 'object' || result.status !== 'rejected') return [];
        const reason = result.reason;
        return [String(label) + '：' + (reason instanceof Error ? reason.message : String(reason))];
      });
      setError(failures.join('；'));
    } finally {
      setLoading(false);
    }
  }, [enabled]);

  React.useEffect(() => {
    void load();
    return window.agentDesktop.agentMail.onStatusChanged(() => {
      if (enabled) void load();
    });
  }, [enabled, load]);

  const visibleMessages = React.useMemo(
    () => mailboxes[direction].filter((message) => messageMatches(message, query.trim())),
    [direction, mailboxes, query],
  );
  const dateGroups = React.useMemo(() => groupAgentMailByDate(visibleMessages), [visibleMessages]);
  const allMessages = React.useMemo(
    () => [...mailboxes.inbox, ...mailboxes.outbox],
    [mailboxes],
  );
  const selectedMessage = selectedMessageId
    ? allMessages.find((message) => message.messageId === selectedMessageId) || null
    : null;
  const parentMessage = selectedMessage?.replyTo
    ? allMessages.find((message) => message.messageId === selectedMessage.replyTo) || null
    : null;

  React.useEffect(() => {
    if (selectedMessageId && !selectedMessage) setSelectedMessageId(null);
  }, [selectedMessage, selectedMessageId]);

  const changeDirection = (nextDirection: MailboxDirection) => {
    setDirection(nextDirection);
    setSelectedMessageId(null);
    setSelectedIds(new Set());
  };

  const toggleSelected = (messageId: string) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const deleteMessages = async (messageIds: string[]) => {
    if (messageIds.length === 0 || deleting) return;
    const description = messageIds.length === 1 ? '这封邮件' : String(messageIds.length) + ' 封邮件';
    if (!window.confirm('从你的协作邮箱中删除' + description + '？\n\n此操作不会删除对方邮箱中的邮件。')) return;
    setDeleting(true);
    try {
      const result = await window.agentDesktop.agentMail.delete(messageIds);
      const deletedIds = new Set(result.messageIds);
      setMailboxes((current) => ({
        inbox: current.inbox.filter((message) => !deletedIds.has(message.messageId)),
        outbox: current.outbox.filter((message) => !deletedIds.has(message.messageId)),
      }));
      setSelectedIds(new Set());
      if (selectedMessageId && deletedIds.has(selectedMessageId)) setSelectedMessageId(null);
      setError('');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : String(deleteError));
      await load();
    } finally {
      setDeleting(false);
    }
  };

  const openParent = () => {
    if (!parentMessage) return;
    const parentDirection = mailboxes.inbox.some((message) => message.messageId === parentMessage.messageId)
      ? 'inbox'
      : 'outbox';
    setQuery('');
    setSelectedIds(new Set());
    setDirection(parentDirection);
    setSelectedMessageId(parentMessage.messageId);
  };

  if (!enabled) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted">
            <Mail className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <div className="text-sm font-medium">协作邮箱尚未启用</div>
            <div className="mt-1 text-xs text-muted-foreground">开启云端模式并启用协作邮箱后可查看邮件。</div>
          </div>
          <Button variant="outline" size="sm" onClick={onOpenSettings}>
            <Settings className="h-4 w-4" />
            打开设置
          </Button>
        </div>
      </div>
    );
  }

  if (selectedMessage) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-background">
        <header className="flex min-h-14 shrink-0 items-center gap-2 border-b px-4 py-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 shrink-0"
            onClick={() => setSelectedMessageId(null)}
            title="返回邮件列表"
            aria-label="返回邮件列表"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0 flex-1 truncate text-sm font-medium">
            {selectedMessage.subject || '(无主题)'}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => void deleteMessages([selectedMessage.messageId])}
            disabled={deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            删除
          </Button>
        </header>
        {error ? (
          <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span className="min-w-0 flex-1 break-words">{error}</span>
          </div>
        ) : null}
        <ScrollArea className="min-h-0 flex-1">
          <article className="mx-auto w-full max-w-3xl px-5 py-5">
            <div className="flex flex-wrap items-center gap-2">
              {selectedMessage.replyTo ? (
                <Badge variant="secondary" className="gap-1 text-[10px] font-normal">
                  <Reply className="h-3 w-3" />回复邮件
                </Badge>
              ) : null}
              <MailStatus message={selectedMessage} />
            </div>
            <h1 className="mt-2 break-words text-lg font-semibold leading-7">
              {selectedMessage.subject || '(无主题)'}
            </h1>
            <dl className="mt-4 grid grid-cols-[52px_minmax(0,1fr)] gap-x-3 gap-y-1.5 border-y py-3 text-xs">
              <dt className="text-muted-foreground">发件人</dt>
              <dd className="min-w-0 break-words">
                {selectedMessage.fromName || selectedMessage.fromUserId}
                <span className="text-muted-foreground"> ({selectedMessage.fromUserId})</span>
              </dd>
              <dt className="text-muted-foreground">收件人</dt>
              <dd className="min-w-0 break-words">
                {selectedMessage.toName || selectedMessage.toUserId}
                <span className="text-muted-foreground"> ({selectedMessage.toUserId})</span>
              </dd>
              <dt className="text-muted-foreground">时间</dt>
              <dd>{formatFullDate(selectedMessage.createdAt)}</dd>
            </dl>
            {selectedMessage.replyTo ? (
              <button
                type="button"
                onClick={openParent}
                disabled={!parentMessage}
                className={cn(
                  'mt-3 flex w-full items-center gap-2 border-l-2 border-primary/40 bg-muted/40 px-3 py-2 text-left text-xs',
                  parentMessage && 'transition-colors hover:bg-muted',
                )}
              >
                <Reply className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate">
                  {parentMessage
                    ? '回复「' + (parentMessage.subject || '(无主题)') + '」'
                    : '回复邮件 ' + selectedMessage.replyTo.slice(0, 12)}
                </span>
              </button>
            ) : null}
            <div className="min-h-32 whitespace-pre-wrap break-words py-5 text-sm leading-6">
              {selectedMessage.content}
            </div>
            {selectedMessage.error ? (
              <div className="mb-4 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive">
                {selectedMessage.error}
              </div>
            ) : null}
            <div className="mt-5 border-t pt-3 text-[10px] text-muted-foreground">
              线程 {selectedMessage.threadId.slice(0, 12)} · 尝试 {selectedMessage.attempts} 次 · 到期 {formatFullDate(selectedMessage.expiresAt)}
            </div>
          </article>
        </ScrollArea>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex min-h-14 shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex h-9 shrink-0 items-center rounded-md bg-muted p-0.5" role="tablist" aria-label="邮箱记录">
          <button
            type="button"
            role="tab"
            aria-selected={direction === 'inbox'}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded px-3 text-xs transition-colors',
              direction === 'inbox' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => changeDirection('inbox')}
          >
            <Inbox className="h-3.5 w-3.5" />
            收信记录
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={direction === 'outbox'}
            className={cn(
              'flex h-8 items-center gap-1.5 rounded px-3 text-xs transition-colors',
              direction === 'outbox' ? 'bg-background font-medium shadow-sm' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => changeDirection('outbox')}
          >
            <Send className="h-3.5 w-3.5" />
            发信记录
          </button>
        </div>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0"
            onClick={() => void deleteMessages([...selectedIds])}
            disabled={selectedIds.size === 0 || deleting}
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            删除{selectedIds.size > 0 ? ' ' + String(selectedIds.size) : ''}
          </Button>
          <div className="relative min-w-[140px] max-w-xs flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="搜索邮件"
              className="h-8 pl-8 text-xs"
            />
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="h-8 w-8 shrink-0"
            onClick={() => void load()}
            disabled={loading}
            title="刷新邮箱"
            aria-label="刷新邮箱"
          >
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>
      </header>

      {error ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words">{error}</span>
          <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={onOpenSettings}>设置</Button>
        </div>
      ) : null}

      <ScrollArea className="min-h-0 flex-1">
        {loading && mailboxes[direction].length === 0 ? (
          <div className="flex h-40 items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            正在加载邮件
          </div>
        ) : dateGroups.length === 0 ? (
          <div className="flex h-40 flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground">
            {direction === 'inbox' ? <Inbox className="h-5 w-5" /> : <Send className="h-5 w-5" />}
            {query.trim() ? '没有匹配的邮件' : direction === 'inbox' ? '暂无收信记录' : '暂无发信记录'}
          </div>
        ) : (
          <div className="px-4 py-4 md:px-6">
            {dateGroups.map((group) => (
              <section key={group.key} className="mb-6 last:mb-0" aria-label={group.label}>
                <h2 className="mb-2 text-xs font-medium text-muted-foreground">
                  {group.label}（{group.messages.length}封）
                </h2>
                <div className="border-t">
                  {group.messages.map((message) => (
                    <div
                      key={message.messageId}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedMessageId(message.messageId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setSelectedMessageId(message.messageId);
                        }
                      }}
                      className="grid min-h-14 w-full min-w-0 cursor-pointer grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-3 border-b px-1 py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 md:grid-cols-[20px_minmax(120px,180px)_minmax(160px,240px)_minmax(0,1fr)_auto]"
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(message.messageId)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => toggleSelected(message.messageId)}
                        className="h-4 w-4 cursor-pointer accent-primary"
                        aria-label={'选择邮件：' + (message.subject || '无主题')}
                      />
                      <div className="min-w-0 md:contents">
                        <div className="truncate text-xs font-medium">
                          {counterpart(message, direction)}
                        </div>
                        <div className="flex min-w-0 items-center gap-1.5">
                          {message.replyTo ? (
                            <Badge variant="outline" className="h-5 shrink-0 gap-1 px-1.5 text-[10px] font-normal">
                              <Reply className="h-3 w-3" />回复
                            </Badge>
                          ) : null}
                          <span className="truncate text-xs font-medium">{message.subject || '(无主题)'}</span>
                        </div>
                        <div className="truncate text-[11px] text-muted-foreground">{message.content}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                        <time>{formatRowDate(message.createdAt)}</time>
                        <MailStatus message={message} compact />
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
