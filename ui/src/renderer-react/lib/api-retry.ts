/** Only protocol facts are displayed; old hosts may omit the allowance. */
export function formatApiRetry(event: Record<string, any>): string {
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const attempt = finite(event.attempt) ? event.attempt : event.retryAttempt;
  const delay = event.retry_delay_ms ?? event.retryInMs;
  const status = event.error_status ?? event.error?.status;
  const budget = event.retry_budget ?? event.retryBudget;
  const parts = ['模型请求重试', finite(status) ? `HTTP ${status}` : '连接异常'];
  if (finite(attempt)) parts.push(`已尝试 ${attempt} 次`);
  if (finite(delay)) parts.push(`计划等待 ${Math.ceil(delay / 1000)} 秒`);
  if (finite(budget?.waitedMs) && finite(budget?.maxWaitMs)) parts.push(`累计等待 ${(budget.waitedMs / 1000).toFixed(1)} / ${budget.maxWaitMs / 1000} 秒`);
  if (finite(budget?.maxAttempts)) parts.push(`最多 ${budget.maxAttempts} 次尝试`);
  return parts.join(' · ');
}
