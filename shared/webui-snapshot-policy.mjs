export const DEFAULT_SNAPSHOT_POLICY = Object.freeze({ maxSnapshotsPerEnvironment: 5, maxBytesPerEnvironment: 20 * 1024 ** 3 });
export function normalizeSnapshotPolicy(value) {
  return Object.fromEntries(Object.entries(DEFAULT_SNAPSHOT_POLICY).map(([key, fallback]) => [key,
    Number.isSafeInteger(value?.[key]) && value[key] > 0 ? value[key] : fallback]));
}
export function validateSnapshotPolicyPatch(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new RangeError('快照额度必须为对象');
  for (const [key, number] of Object.entries(value)) {
    if (!(Object.hasOwn(DEFAULT_SNAPSHOT_POLICY, key)) || !Number.isSafeInteger(number) || number <= 0) throw new RangeError(`无效的快照额度：${key}，必须为正整数`);
  }
}
