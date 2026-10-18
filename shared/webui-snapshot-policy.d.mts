export type SnapshotPolicy = { maxSnapshotsPerEnvironment: number; maxBytesPerEnvironment: number };
export const DEFAULT_SNAPSHOT_POLICY: Readonly<SnapshotPolicy>;
export function normalizeSnapshotPolicy(value?: unknown): SnapshotPolicy;
export function validateSnapshotPolicyPatch(value: unknown): void;
