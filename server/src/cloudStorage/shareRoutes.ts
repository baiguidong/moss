import { randomBytes, randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { pipeline } from 'node:stream/promises'
import type { AuthContext } from '../auth/token.js'
import { body, json, parseRange } from './routes.js'
import { CloudError } from './service.js'
import { CloudSharesService } from './shares.js'

const escape = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
function page(res: ServerResponse, status: number, title: string, description: string, token?: string) {
  const nonce = randomBytes(18).toString('base64')
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)} · Moss 文件分享</title>
<style nonce="${nonce}">:root{color-scheme:light dark;font-family:system-ui,sans-serif}body{margin:0;background:light-dark(#f5f7f4,#19231d);color:light-dark(#243c2d,#edf5ef);display:grid;place-items:center;min-height:100vh}main{box-sizing:border-box;width:min(440px,100%);padding:32px}small{opacity:.65}h1{font-size:22px;overflow-wrap:anywhere}p{line-height:1.7;overflow-wrap:anywhere}input,button{font:inherit;box-sizing:border-box;width:100%;padding:12px;border-radius:8px;margin-top:12px}input{border:1px solid #789480;background:transparent;color:inherit}button{border:0;background:#34864c;color:white;cursor:pointer}button:disabled{opacity:.6}label{display:block}#error{color:light-dark(#b42626,#ffabab)}a{color:inherit}</style></head><body><main><small>Moss · 文件分享</small><h1>${escape(title)}</h1><p>${escape(description)}</p>
${token ? `<form><label for="code">分享码</label><input id="code" name="code" autofocus required minlength="4" maxlength="12" pattern="[a-zA-Z0-9]{4,12}" autocomplete="off"><p id="error" role="alert"></p><button>验证并下载</button></form><script nonce="${nonce}">const form=document.querySelector('form');form.addEventListener('submit',async event=>{event.preventDefault();const button=form.querySelector('button'),error=document.querySelector('#error');button.disabled=true;error.textContent='';try{const response=await fetch('/s/${token}/verify',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({accessCode:form.elements.code.value})});const result=await response.json();if(!response.ok)throw new Error(result.error?.message||'暂时无法验证，请重试');window.location.assign('/s/${token}/download');button.textContent='再次下载'}catch(cause){error.textContent=cause.message}finally{button.disabled=false}});</script>` : ''}
</main></body></html>`
  res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
    'content-security-policy': `default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'` })
  res.end(html)
}

function failure(res: ServerResponse, error: unknown, html = false) {
  if (res.headersSent || res.destroyed) { res.destroy(); return }
  res.removeHeader('content-disposition')
  res.removeHeader('etag')
  const e = error as { status?: number; code?: string; message?: string }
  const known = error instanceof CloudError
  const status = known || e.status === 401 || e.status === 403 ? e.status! : 503
  const message = known ? e.message! : status === 403 ? '暂无分享权限' : status === 401 ? '需要重新登录' : '文件服务暂时不可用，请稍后重试'
  if (status === 429) res.setHeader('retry-after', '600')
  if (html) page(res, status, message, status === 410 ? '请联系分享者获取新的链接。' : '请检查分享链接，或稍后重试。')
  else json(res, status, { error: { code: known ? e.code : status === 403 ? 'FORBIDDEN' : status === 401 ? 'UNAUTHENTICATED' : 'STORAGE_UNAVAILABLE', message } })
}

export async function handleShareManagement(req: IncomingMessage, res: ServerResponse, url: URL, auth: AuthContext, shares: CloudSharesService) {
  const prefix = '/api/v1/cloud-storage/shares'
  if (url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) return false
  try {
    if (url.pathname === prefix && req.method === 'POST')
      json(res, 201, await shares.create(auth, await body(req, ['fileId', 'requestKey', 'expiresAt', 'accessCode'])))
    else if (url.pathname === prefix && req.method === 'GET') {
      const input: Record<string, unknown> = {}
      for (const key of ['fileId', 'cursor']) if (url.searchParams.has(key)) input[key] = url.searchParams.get(key)
      if (url.searchParams.has('limit')) input.limit = Number(url.searchParams.get('limit'))
      json(res, 200, await shares.list(auth, input))
    } else if (req.method === 'DELETE' && /^\/[a-zA-Z0-9_-]{1,128}$/.test(url.pathname.slice(prefix.length)))
      json(res, 200, await shares.revoke(auth, url.pathname.slice(prefix.length + 1)))
    else throw new CloudError(405, 'METHOD_NOT_ALLOWED', 'Unsupported share operation')
  } catch (error) { failure(res, error) }
  return true
}

export async function handlePublicShare(req: IncomingMessage, res: ServerResponse, url: URL, shares: CloudSharesService) {
  if (!url.pathname.startsWith('/s/')) return false
  const match = /^\/s\/([a-zA-Z0-9_-]{43})(?:\/(verify|download))?$/.exec(url.pathname)
  const controller = new AbortController()
  const abort = () => { if (!res.writableFinished) controller.abort() }
  req.once('aborted', abort); res.once('close', abort)
  res.setHeader('referrer-policy', 'no-referrer')
  try {
    if (!match) throw new CloudError(404, 'SHARE_NOT_FOUND', '分享不存在')
    const token = match[1]!, action = match[2]
    if (action === 'verify' && req.method === 'POST') {
      if (!req.headers['content-type']?.startsWith('application/json')) throw new CloudError(415, 'INVALID_INPUT', '请使用分享页面验证')
      const input = await body(req, ['accessCode'])
      const session = await shares.verify(token, input.accessCode, req.socket.remoteAddress || 'unknown')
      const secure = shares.storage.config.publicUrl?.startsWith('https:') || Boolean((req.socket as { encrypted?: boolean }).encrypted)
      res.setHeader('set-cookie', `moss_share=${session}; Path=/s/${token}; HttpOnly; SameSite=Strict; Max-Age=1800${secure ? '; Secure' : ''}`)
      json(res, 200, { ok: true })
      return true
    }
    if (!['GET', 'HEAD'].includes(req.method || '') || action === 'verify') throw new CloudError(405, 'METHOD_NOT_ALLOWED', '不支持此操作')
    const { row, file } = await shares.resolve(token)
    const cookie = req.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('moss_share='))?.slice(11) ?? ''
    if (row.codeHash && !shares.sessionValid(row, cookie)) {
      page(res, 200, file.name, '输入分享码即可下载，无需登录 Moss。', token)
      return true
    }
    const etag = `"${file.revision}"`
    if ((req.headers['if-match'] && req.headers['if-match'] !== etag) || (req.headers['if-range'] && req.headers['if-range'] !== etag))
      throw new CloudError(412, 'REVISION_CHANGED', '文件内容已变化，请重新下载')
    res.setHeader('accept-ranges', 'bytes'); res.setHeader('etag', etag)
    res.setHeader('cache-control', 'private, no-store')
    let range: ReturnType<typeof parseRange>
    try { range = parseRange(req.method === 'HEAD' ? undefined : req.headers.range, file.size) }
    catch (error) { res.setHeader('content-range', `bytes */${file.size}`); throw error }
    const length = range ? range.end - range.start + 1 : file.size
    res.setHeader('content-type', 'application/octet-stream')
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('content-disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16)}`)}`)
    if (range) res.setHeader('content-range', `bytes ${range.start}-${range.end}/${file.size}`)
    if (req.method === 'HEAD') { res.writeHead(200, { 'content-length': length }); res.end(); return true }
    // Shares have their own authorization. Never synthesize an owner's JWT.
    const owner = { orgId: row.orgId, userId: row.ownerUserId } as AuthContext
    const revalidate = async () => {
      await shares.resolve(token)
      if (row.codeHash && !shares.sessionValid(row, cookie)) throw new CloudError(403, 'SHARE_SESSION_EXPIRED', '请重新输入分享码')
    }
    const lease = shares.storage.acquire(owner, `download:${file.id}:share:${randomUUID()}`, 'read', controller.signal, revalidate)
    try {
      const store = await shares.storage.ensure()
      const stream = await store.get(file.objectKey, range ? `bytes=${range.start}-${range.end}` : undefined, lease.signal)
      try { await revalidate() } catch (error) { stream.destroy(); throw error }
      res.writeHead(range ? 206 : 200, { 'content-length': length })
      await pipeline(stream, res, { signal: lease.signal })
    } finally { lease.release() }
  } catch (error) { failure(res, error, match?.[2] !== 'verify') }
  finally { req.off('aborted', abort); res.off('close', abort) }
  return true
}
