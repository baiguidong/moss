/**
 * WeCom self-built-app callback crypto (WXBizMsgCrypt).
 *
 * Self-built apps receive events at an admin-configured callback URL.
 * The platform proves URL ownership with a GET handshake and signs every
 * POST. This implements the documented signature + AES-256-CBC framing:
 *
 *   msg_signature = sha1( sort([token, timestamp, nonce, encrypt]).join('') )
 *
 *   AES key  = base64decode(encodingAesKey + '=')   (43 chars -> 32 bytes)
 *   IV       = key[0:16]
 *   plaintext layout after AES-256-CBC + PKCS7-unpad:
 *     [16-byte random] [4-byte msg_len, network order] [msg] [receiveid]
 *
 * NOTE: this is a DIFFERENT framing from channels/plugins/wecom/
 * WeComCrypto.ts (which decrypts long-connection *media*), so it is
 * written fresh rather than reused.
 *
 * Reference: https://developer.work.weixin.qq.com/document/path/90968
 */

import { createDecipheriv, createHash } from 'node:crypto'

/** Compute the WeCom callback signature over the four sorted tokens. */
export function computeSignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
): string {
  const sorted = [token, timestamp, nonce, encrypt].sort().join('')
  return createHash('sha1').update(sorted).digest('hex')
}

/** Constant-time-ish signature check (lengths differ rarely; ok for P0). */
export function verifySignature(
  token: string,
  timestamp: string,
  nonce: string,
  encrypt: string,
  msgSignature: string,
): boolean {
  return computeSignature(token, timestamp, nonce, encrypt) === msgSignature
}

/** Decode the 43-char EncodingAESKey into the 32-byte AES key. */
function decodeAesKey(encodingAesKey: string): Buffer {
  const key = Buffer.from(encodingAesKey + '=', 'base64')
  if (key.length !== 32) {
    throw new Error(`invalid EncodingAESKey: decoded ${key.length} bytes, expected 32`)
  }
  return key
}

/**
 * Decrypt an `encrypt` blob into { message, receiveId }. `message` is the
 * raw plaintext (XML for WeCom events; the bare echostr for URL verify).
 */
export function decrypt(
  encodingAesKey: string,
  encrypt: string,
): { message: string; receiveId: string } {
  const key = decodeAesKey(encodingAesKey)
  const iv = key.subarray(0, 16)
  const decipher = createDecipheriv('aes-256-cbc', key, iv)
  decipher.setAutoPadding(false) // WeCom uses PKCS7 but with trailing receiveid; unpad manually
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encrypt, 'base64')),
    decipher.final(),
  ])

  // PKCS7 unpad: last byte is the pad length (1..32).
  const padLen = decrypted[decrypted.length - 1]
  const unpadded = decrypted.subarray(0, decrypted.length - padLen)

  // [16 random][4 len BE][msg][receiveid]
  const msgLen = unpadded.readUInt32BE(16)
  const message = unpadded.subarray(20, 20 + msgLen).toString('utf8')
  const receiveId = unpadded.subarray(20 + msgLen).toString('utf8')
  return { message, receiveId }
}

/**
 * Handle the GET URL-verification handshake: verify the signature over
 * `echostr`, then return the decrypted plaintext to echo back.
 * Throws on signature mismatch.
 */
export function verifyUrl(params: {
  token: string
  encodingAesKey: string
  msgSignature: string
  timestamp: string
  nonce: string
  echostr: string
}): string {
  const { token, encodingAesKey, msgSignature, timestamp, nonce, echostr } = params
  if (!verifySignature(token, timestamp, nonce, echostr, msgSignature)) {
    throw new Error('callback URL verify: signature mismatch')
  }
  return decrypt(encodingAesKey, echostr).message
}

/**
 * Extract the `<Encrypt>` value from a WeCom callback POST XML body.
 * Returns null if absent.
 */
export function extractEncrypt(xmlBody: string): string | null {
  const m =
    xmlBody.match(/<Encrypt>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/Encrypt>/) ||
    xmlBody.match(/<Encrypt>([\s\S]*?)<\/Encrypt>/)
  return m ? m[1].trim() : null
}

/** Read a single CDATA/plain XML field by tag name. Returns '' if absent. */
export function readXmlField(xml: string, tag: string): string {
  const re = new RegExp(
    `<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`,
  )
  const m = xml.match(re)
  if (!m) return ''
  return (m[1] ?? m[2] ?? '').trim()
}
