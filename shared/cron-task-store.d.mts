export type CronStoreEntry = { id: string; [key: string]: unknown };

/** Missing files read as an empty store; malformed files throw. */
export function readCronTaskStore<Task extends { id: string } = CronStoreEntry>(
  filePath: string,
): Promise<Task[]>;

/** Mutate the latest tasks synchronously while holding the shared file lock. */
export function updateCronTaskStore<Task extends { id: string } = CronStoreEntry, Result = unknown>(
  filePath: string,
  update: (tasks: Task[]) => Result,
): Promise<Result>;
