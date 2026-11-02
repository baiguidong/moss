import path from 'node:path';
import { updateCronTaskStore } from '../../../shared/cron-task-store.mjs';
import { parseMossCronExpression } from '../moss-cron-scheduler.mjs';

// Configuration is reconciled durably; applying the same revision never runs a task.
export function createManagedSchedules({ home, createOwner, ownerExists }) {
  const filename = path.join(home, 'cron_tasks.json');
  return async (desired, account, isCurrent = () => true) => {
    const reports = [];
    for (const item of desired) {
      try {
        await updateCronTaskStore(filename, tasks => {
          if (!isCurrent()) throw new Error('企业账号已切换');
          const id = `enterprise-${item.id}`;
          const index = tasks.findIndex(task => task.id === id);
          const current = tasks[index];
          if (current && current.controlAccount !== account) throw new Error('任务归属不匹配');
          if (item.deleted) {
            if (current?.runId) throw new Error('等待当前执行结束后删除');
            if (current) tasks.splice(index, 1);
            return;
          }
          if (current?.controlRevision >= item.revision && ownerExists(current.ownerSessionId)) return;
          if (current?.runId) throw new Error('等待当前执行结束后应用配置');
          if (!parseMossCronExpression(item.config.cron)) throw new Error('不支持的 cron 表达式');
          const ownerSessionId = current && ownerExists(current.ownerSessionId) ? current.ownerSessionId : createOwner(item.config.name);
          const task = { ...current, id, ...item.config, ownerSessionId,
            durable: true, recurring: true, controlAccount: account, controlRevision: item.revision,
            createdAt: current?.createdAt || Date.now(), status: 'idle', lastError: null };
          delete task.nextRunAt;
          if (index < 0) tasks.push(task); else tasks[index] = task;
        });
        reports.push({ id: item.id, revision: item.revision });
      } catch (error) { reports.push({ id: item.id, revision: item.revision, error: error.message }); }
    }
    return reports;
  };
}
