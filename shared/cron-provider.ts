/** Scheduling is supplied by the host; the Agent never chooses an account or server. */
export type HostCronTask = {
  id: string; cron: string; prompt: string; createdAt: number
  recurring?: boolean; durable?: boolean; agentId?: string
  enabled?: boolean; status?: string; lastError?: string | null; timezone?: string
  nextRunAt?: number | null
}
export type CronProvider = {
  create(input: { cron: string; prompt: string; recurring: boolean; timezone?: string; agentId?: string }): Promise<{ id: string }>
  list(): Promise<HostCronTask[]>
  remove(ids: string[]): Promise<void>
}
