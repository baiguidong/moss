const STATUS_PRIORITY = new Map([
  ['waiting_for_user', 0],
  ['working', 1],
  ['failed', 2],
  ['completed', 3],
  ['stopped', 4],
]);

function taskTimestamp(task, field) {
  if (Number.isFinite(task?.[field])) return task[field];
  if (Number.isFinite(task?.metadata?.[field])) return task.metadata[field];
  return 0;
}

export function filterAndSortProjectTasks(tasks, options = {}) {
  const query = String(options.query || '').trim().toLocaleLowerCase('zh-Hans-CN');
  const status = typeof options.status === 'string' && options.status ? options.status : 'all';
  const sort = ['newest', 'oldest', 'updated', 'status'].includes(options.sort)
    ? options.sort
    : 'newest';
  return (Array.isArray(tasks) ? tasks : [])
    .map((task, index) => ({ task, index }))
    .filter(({ task }) => status === 'all' || task?.status === status)
    .filter(({ task }) => {
      if (!query) return true;
      return [
        task?.subject,
        task?.description,
        task?.conclusion,
        task?.error,
      ].some((value) => String(value || '').toLocaleLowerCase('zh-Hans-CN').includes(query));
    })
    .sort((left, right) => {
      if (sort === 'oldest') {
        return taskTimestamp(left.task, 'createdAt') - taskTimestamp(right.task, 'createdAt') ||
          left.index - right.index;
      }
      if (sort === 'updated') {
        return taskTimestamp(right.task, 'updatedAt') - taskTimestamp(left.task, 'updatedAt') ||
          taskTimestamp(right.task, 'createdAt') - taskTimestamp(left.task, 'createdAt') ||
          right.index - left.index;
      }
      if (sort === 'status') {
        return (STATUS_PRIORITY.get(left.task?.status) ?? 99) - (STATUS_PRIORITY.get(right.task?.status) ?? 99) ||
          taskTimestamp(right.task, 'createdAt') - taskTimestamp(left.task, 'createdAt') ||
          right.index - left.index;
      }
      return taskTimestamp(right.task, 'createdAt') - taskTimestamp(left.task, 'createdAt') ||
        right.index - left.index;
    })
    .map(({ task }) => task);
}
