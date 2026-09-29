import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { ObjectStore } from '../cloudStorage/s3.js'
import { randomUUID } from 'node:crypto'
import type { Database } from '../model/database.js'

type Request = (suffix: string, method?: string, data?: any, token?: string, expected?: number, headers?: Record<string, string>) => Promise<Response>

// Invoked by the real HTTP/SQLite (and optional MySQL/S3) storage fixture.
export async function verifyCloudShares(options: {
  base: string; request: Request; db: Database; token: string; other: string; foreign: string
  fileId: string; folderId: string; size: number; store: ObjectStore
}) {
  const { base, request, db, token, other, foreign, fileId, folderId, size } = options
  const create = async (input: Record<string, unknown>, expected = 201, auth = token) =>
    (await request('/shares', 'POST', input, auth, expected)).json() as Promise<any>
  const settings = { fileId, requestKey: randomUUID(), expiresAt: Date.now() + 86400000, accessCode: '246810' }
  const [share, duplicate] = await Promise.all([create(settings), create(settings)])
  assert.equal(duplicate.id, share.id)
  assert.equal(share.accessCode, '246810')
  assert.equal(share.state, 'active')
  await create({ ...settings, accessCode: null }, 409)
  await create({ ...settings, requestKey: randomUUID(), orgId: 'spoof' }, 400)
  await create({ ...settings, requestKey: randomUUID(), expiresAt: Date.now() - 1 }, 400)
  await create({ ...settings, requestKey: randomUUID(), expiresAt: Date.now() + 400 * 86400000 }, 400)
  await create({ ...settings, requestKey: randomUUID(), fileId: folderId }, 400)
  await create({ ...settings, requestKey: randomUUID() }, 404, other)
  await create({ ...settings, requestKey: randomUUID() }, 404, foreign)
  for (const auth of [other, foreign]) {
    assert.equal((await (await request('/shares', 'GET', undefined, auth)).json() as any).shares.length, 0)
    await request(`/shares/${share.id}`, 'DELETE', undefined, auth, 404)
  }
  const url = new URL(share.url, base).href
  let response = await fetch(url)
  assert.equal(response.status, 200)
  assert.match(response.headers.get('content-type')!, /text\/html/)
  const html = await response.text()
  assert.match(html, /分享码/); assert.ok(!html.includes(share.accessCode))
  response = await fetch(`${url}/download`, { method: 'HEAD' })
  assert.ok(!response.headers.has('content-disposition'))
  response = await fetch(`${url}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: 'wrong1' }) })
  assert.equal(response.status, 403)
  response = await fetch(`${url}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: share.accessCode }) })
  assert.equal(response.status, 200)
  if (process.env.MOSS_SHARE_PLAYWRIGHT) {
    const { chromium } = await import(process.env.MOSS_SHARE_PLAYWRIGHT)
    const browser = await chromium.launch({ channel: 'chrome', headless: true })
    try {
      const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 600, height: 700 } })
      await page.goto(url)
      await page.getByRole('textbox', { name: '分享码', exact: true }).fill('wrong1')
      await page.getByRole('button', { name: '验证并下载' }).click()
      await page.getByText('分享码不正确', { exact: true }).waitFor()
      await page.getByRole('textbox', { name: '分享码', exact: true }).fill(share.accessCode)
      if (process.env.MOSS_SHARE_SCREENSHOTS) {
        await mkdir(process.env.MOSS_SHARE_SCREENSHOTS, { recursive: true })
        await page.screenshot({ path: join(process.env.MOSS_SHARE_SCREENSHOTS, 'public-share.png') })
      }
      const downloaded = page.waitForEvent('download')
      await page.getByRole('button', { name: '验证并下载' }).click()
      const download = await downloaded
      assert.equal((await stat(await download.path())).size, size)
      console.log('Public share browser verification and download passed')
    } finally { await browser.close() }
  }
  const setCookie = response.headers.get('set-cookie')!
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Strict/)
  const cookie = setCookie.split(';')[0]!
  response = await fetch(`${url}/download`, { headers: { cookie, range: 'bytes=10-25' } })
  assert.equal(response.status, 206)
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.alloc(16, 1))
  assert.match(response.headers.get('content-disposition')!, /attachment/)
  response = await fetch(`${url}/download`, { method: 'HEAD', headers: { cookie } })
  assert.equal(Number(response.headers.get('content-length')), size)
  response = await fetch(`${url}/download`, { headers: { cookie, range: `bytes=${size}-` } })
  assert.equal(response.status, 416)
  response = await fetch(`${url}/download`, { headers: { cookie, 'if-match': '"wrong"' } })
  assert.equal(response.status, 412)

  const open = await create({ fileId, requestKey: randomUUID(), expiresAt: null, accessCode: null })
  const openUrl = new URL(open.url, base).href
  response = await fetch(openUrl, { headers: { range: 'bytes=0-3' } })
  assert.equal(response.status, 206); assert.equal((await response.arrayBuffer()).byteLength, 4)
  response = await fetch(`${base}/api/v1/cloud-storage/files/${fileId}/content`)
  assert.equal(response.status, 401)
  const stored = await db.prepare('SELECT secret,codeHash,tokenHash FROM cloud_shares WHERE id=?').get(share.id)
  assert.ok(!String(stored!.secret).includes('246810'))
  assert.ok(!String(stored!.secret).includes(new URL(url).pathname.slice(3)))
  assert.notEqual(stored!.codeHash, '246810')

  const first = await (await request('/shares?limit=1')).json() as any
  const second = await (await request(`/shares?limit=1&cursor=${first.nextCursor}`)).json() as any
  assert.equal(first.shares.length, 1); assert.equal(second.shares.length, 1)
  assert.notEqual(first.shares[0].id, second.shares[0].id)
  assert.equal(second.nextCursor, null)

  await request(`/shares/${share.id}`, 'DELETE')
  await request(`/shares/${share.id}`, 'DELETE')
  response = await fetch(`${url}/download`, { headers: { cookie } })
  assert.equal(response.status, 410)
  await db.prepare('UPDATE cloud_shares SET expiresAt=? WHERE id=?').run(Date.now() - 1, open.id)
  response = await fetch(openUrl, { method: 'HEAD' }); assert.equal(response.status, 410)
  const listing = await (await request('/shares')).json() as any
  assert.equal(listing.shares.find((item: any) => item.id === open.id).state, 'expired')
  assert.equal(listing.shares.find((item: any) => item.id === share.id).state, 'revoked')

  const changed = await create({ fileId, requestKey: randomUUID(), expiresAt: null, accessCode: null })
  const revision = (await db.prepare('SELECT revision FROM cloud_files WHERE id=?').get(fileId))!.revision!
  await db.prepare('UPDATE cloud_files SET revision=? WHERE id=?').run('changed', fileId)
  response = await fetch(new URL(changed.url, base)); assert.equal(response.status, 410)
  await db.prepare('UPDATE cloud_files SET revision=? WHERE id=?').run(revision, fileId)
  await db.prepare("UPDATE cloud_files SET state='deleting' WHERE id=?").run(fileId)
  response = await fetch(new URL(changed.url, base)); assert.equal(response.status, 410)
  await db.prepare("UPDATE cloud_files SET state='ready' WHERE id=?").run(fileId)

  const owner = (await db.prepare('SELECT orgId,ownerUserId FROM cloud_shares WHERE id=?').get(changed.id))!
  await db.prepare("UPDATE users SET status='disabled' WHERE id=?").run(owner.ownerUserId!)
  response = await fetch(new URL(changed.url, base)); assert.equal(response.status, 410)
  await db.prepare("UPDATE users SET status='active' WHERE id=?").run(owner.ownerUserId!)

  const streaming = await create({ fileId, requestKey: randomUUID(), expiresAt: null, accessCode: null })
  const originalGet = options.store.get.bind(options.store)
  options.store.get = async (...args) => {
    const source = await originalGet(...args)
    return Readable.from((async function* () {
      for await (const chunk of source) for (let offset = 0; offset < chunk.length; offset += 1024) {
        if (args[2]?.aborted) throw new Error('Share cancelled')
        yield chunk.subarray(offset, offset + 1024)
        await delay(10)
      }
    })())
  }
  try {
    response = await fetch(new URL(streaming.url, base), { headers: { range: 'bytes=0-1048575' } })
    const reader = response.body!.getReader()
    assert.equal((await reader.read()).done, false)
    await request(`/shares/${streaming.id}`, 'DELETE')
    await assert.rejects(async () => { while (!(await reader.read()).done) {} })
  } finally { options.store.get = originalGet }

  const limited = await create({ fileId, requestKey: randomUUID(), expiresAt: null })
  const limitedUrl = new URL(limited.url, base).href
  for (let index = 0; index < 12; index++) {
    response = await fetch(`${limitedUrl}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: limited.accessCode }) })
    assert.equal(response.status, 200, 'Successful recipients do not consume the failure budget')
  }
  for (let index = 0; index < 11; index++) {
    response = await fetch(`${limitedUrl}/verify`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ accessCode: 'wrong1' }) })
    assert.equal(response.status, index < 10 ? 403 : 429)
  }
  // Leave one live share for the fixture's actual server restart check.
  return changed
}
