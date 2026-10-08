export async function runInKeyedQueue(queue, key, operation) {
  const previous = queue.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queue.set(key, current);
  try {
    return await current;
  } finally {
    if (queue.get(key) === current) queue.delete(key);
  }
}
