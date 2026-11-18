import { createHash, randomUUID, verify } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

export function verifyOfflineKit(id, version, platform, kit, publisher) {
  const key = publisher?.keys?.[kit.keyId] || publisher?.[kit.keyId]
  const payload = JSON.stringify([
    'moss.offline-kit/v1',
    id,
    version,
    platform,
    kit.publisherId,
    kit.keyId,
    kit.fileName,
    kit.appSha256,
    kit.sha256,
    kit.size,
  ])
  if (!key || !verify(null, Buffer.from(payload), key, Buffer.from(kit.signature, 'base64'))) {
    throw new Error('离线包发布者签名无效')
  }
}

export async function downloadOfflineKit(kit, destination, { validateUrl, onProgress }) {
  const temporary = path.join(path.dirname(destination), `.moss-kit-${randomUUID()}.part`)
  const abort = new AbortController()
  const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(30 * 60_000)])
  const digest = createHash('sha256')
  let received = 0,
    lastReport = 0
  try {
    let url = validateUrl(kit.downloadUrl)
    for (let redirects = 0; ; redirects++) {
      const response = await fetch(url, { redirect: 'manual', signal })
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        await response.body?.cancel()
        const next = response.headers.get('location')
        if (redirects >= 8 || !next) throw new Error('离线包下载重定向无效')
        url = validateUrl(new URL(next, url).href)
        continue
      }
      if (!response.ok || !response.body) throw new Error(`离线包下载失败 (HTTP ${response.status})`)
      const output = await fs.open(temporary, 'wx', 0o600)
      try {
        for await (const chunk of response.body) {
          received += chunk.length
          if (received > kit.size) throw new Error('离线包超过发布大小')
          digest.update(chunk)
          await output.writeFile(chunk)
          if (Date.now() - lastReport >= 150 || received === kit.size) {
            lastReport = Date.now()
            onProgress(received)
          }
        }
      } finally {
        await output.close()
      }
      break
    }
    if (received !== kit.size || digest.digest('hex') !== kit.sha256)
      throw new Error('离线包大小或 SHA-256 校验失败')
    await fs.rename(temporary, destination)
  } finally {
    abort.abort()
    await fs.rm(temporary, { force: true })
  }
}
