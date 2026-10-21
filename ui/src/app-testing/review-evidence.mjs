import fs from 'node:fs/promises';
import path from 'node:path';

// Read only this run's immutable screenshot evidence. Deliver the real images
// in the initial model request instead of asking an agent to rediscover files.
export async function resolveReviewEvidence(prompt, files, evidenceDir) {
  if (!Array.isArray(files) || !files.length || files.length > 60) throw new Error('图片验收需要本轮截图。');
  const root = await fs.realpath(evidenceDir);
  const content = [{ type: 'text', text: prompt }];
  const attachments = [];
  let total = 0;
  for (const file of [...new Set(files)]) {
    if (typeof file !== 'string' || !file.trim()) throw new Error('截图路径无效。');
    const full = await fs.realpath(path.resolve(root, file));
    const relative = path.relative(root, full);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('截图必须位于本轮证据目录。');
    const stat = await fs.stat(full);
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024 || (total += stat.size) > 32 * 1024 * 1024) throw new Error('本批截图超过大小上限。');
    const bytes = await fs.readFile(full);
    const mime = bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ? 'image/png'
      : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg'
        : bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP' ? 'image/webp' : null;
    if (!mime) throw new Error('证据必须是真实 PNG、JPEG 或 WebP 图片。');
    attachments.push(full);
    content.push({ type: 'text', text: `截图：${relative}` },
      { type: 'image', source: { type: 'base64', media_type: mime, data: bytes.toString('base64') } });
  }
  return { content, attachments };
}

export async function attachReviewEvidence(prompt, files, evidenceDir) {
  return (await resolveReviewEvidence(prompt, files, evidenceDir)).content;
}
