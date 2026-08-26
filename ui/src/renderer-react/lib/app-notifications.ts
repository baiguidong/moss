export type AppNotificationSeverity = 'error' | 'warning' | 'info';

export type AppNotification = {
  id: string;
  severity: AppNotificationSeverity;
  source: string;
  title: string;
  message: string;
  details?: string;
  createdAt: number;
  read: boolean;
  occurrences: number;
};

export type NewAppNotification = Pick<AppNotification, 'severity' | 'source' | 'title' | 'message'> & {
  details?: string;
};

export const APP_NOTIFICATIONS_STORAGE_KEY = 'moss.app-notifications.v1';
export const MAX_APP_NOTIFICATIONS = 200;
const DEDUPE_WINDOW_MS = 10_000;
const MAX_SOURCE_LENGTH = 120;
const MAX_TITLE_LENGTH = 240;
const MAX_MESSAGE_LENGTH = 4_000;
const MAX_DETAILS_LENGTH = 16_000;

type NotificationStorage = Pick<Storage, 'getItem' | 'setItem'>;

function isSeverity(value: unknown): value is AppNotificationSeverity {
  return value === 'error' || value === 'warning' || value === 'info';
}

function sanitizeDiagnosticText(value: unknown, maxLength: number): string {
  return String(value || '')
    .replace(/([?&](?:access_token|refresh_token|token|code|client_secret|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(\b(?:access[_-]?token|refresh[_-]?token|client[_-]?secret|api[_-]?key|password|authorization)\b\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, '$1[REDACTED]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [REDACTED]')
    .slice(0, maxLength);
}

function parseNotification(value: unknown): AppNotification | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Partial<AppNotification>;
  if (
    typeof item.id !== 'string' ||
    !isSeverity(item.severity) ||
    typeof item.source !== 'string' ||
    typeof item.title !== 'string' ||
    typeof item.message !== 'string' ||
    typeof item.createdAt !== 'number'
  ) {
    return null;
  }
  return {
    id: item.id,
    severity: item.severity,
    source: sanitizeDiagnosticText(item.source, MAX_SOURCE_LENGTH),
    title: sanitizeDiagnosticText(item.title, MAX_TITLE_LENGTH),
    message: sanitizeDiagnosticText(item.message, MAX_MESSAGE_LENGTH),
    ...(typeof item.details === 'string' && item.details
      ? { details: sanitizeDiagnosticText(item.details, MAX_DETAILS_LENGTH) }
      : {}),
    createdAt: item.createdAt,
    read: Boolean(item.read),
    occurrences: Math.max(1, Math.floor(Number(item.occurrences) || 1)),
  };
}

export function loadAppNotifications(storage?: NotificationStorage | null): AppNotification[] {
  if (!storage) return [];
  try {
    const parsed = JSON.parse(storage.getItem(APP_NOTIFICATIONS_STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(parseNotification)
      .filter((item): item is AppNotification => Boolean(item))
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, MAX_APP_NOTIFICATIONS);
  } catch {
    return [];
  }
}

export function saveAppNotifications(
  notifications: AppNotification[],
  storage?: NotificationStorage | null,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      APP_NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify(notifications.slice(0, MAX_APP_NOTIFICATIONS)),
    );
  } catch {
    // Diagnostics must never interrupt the operation being diagnosed.
  }
}

export function appendAppNotification(
  notifications: AppNotification[],
  input: NewAppNotification,
  options: { now?: number; id?: string } = {},
): AppNotification[] {
  const now = options.now ?? Date.now();
  const source = sanitizeDiagnosticText(input.source, MAX_SOURCE_LENGTH).trim() || 'Moss';
  const title = sanitizeDiagnosticText(input.title, MAX_TITLE_LENGTH).trim() || '应用消息';
  const message = sanitizeDiagnosticText(input.message, MAX_MESSAGE_LENGTH).trim() || '未提供错误信息';
  const details = sanitizeDiagnosticText(input.details, MAX_DETAILS_LENGTH).trim();
  const duplicateIndex = notifications.findIndex((item) =>
    item.source === source &&
    item.title === title &&
    item.message === message &&
    now - item.createdAt <= DEDUPE_WINDOW_MS
  );

  if (duplicateIndex >= 0) {
    const duplicate = notifications[duplicateIndex];
    return [
      {
        ...duplicate,
        details: details || duplicate.details,
        createdAt: now,
        read: false,
        occurrences: duplicate.occurrences + 1,
      },
      ...notifications.filter((_, index) => index !== duplicateIndex),
    ].slice(0, MAX_APP_NOTIFICATIONS);
  }

  const id = options.id || (
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${now}-${Math.random().toString(36).slice(2, 10)}`
  );
  return [{
    id,
    severity: input.severity,
    source,
    title,
    message,
    ...(details ? { details } : {}),
    createdAt: now,
    read: false,
    occurrences: 1,
  }, ...notifications].slice(0, MAX_APP_NOTIFICATIONS);
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === 'string') return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error || 'Unknown error');
  }
}

export function cleanIpcErrorMessage(error: unknown): string {
  let message = getErrorMessage(error).trim();
  message = message.replace(
    /^Error invoking remote method\s+[‘’'"][^‘’'"]+[‘’'"]:\s*/i,
    '',
  );
  while (/^Error:\s*/i.test(message)) {
    message = message.replace(/^Error:\s*/i, '').trim();
  }
  return message || '连接器授权请求失败';
}
