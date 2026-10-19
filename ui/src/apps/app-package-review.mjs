import { createHash } from 'node:crypto';
export function packageReviewRevision(info) {
  return createHash('sha256').update(JSON.stringify({ manifest: info.manifest,
    checksums: Object.entries(info.checksums || {}).sort(([a], [b]) => a.localeCompare(b)), trust: info.trust || null })).digest('hex');
}
export function assertReviewedPackage(before, after) {
  if (packageReviewRevision(before) !== packageReviewRevision(after)) throw new Error('确认期间安装包内容已变化，请重新检查并授权。');
}
