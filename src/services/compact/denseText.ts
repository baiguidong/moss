/**
 * Prompt payloads containing base64 or SVG are easy to underestimate with a
 * plain `characters / 4` heuristic. They are often generated as one huge
 * string and can still overflow the API after a summary has been produced.
 */

const LONG_BASE64_RUN = /[A-Za-z0-9+/]{96,}={0,2}/g
const DATA_URI_BASE64 = /^data:[^;,]+;base64,/i

export type DenseTextKind = 'base64' | 'svg' | 'encoded-run'

export function classifyDenseText(value: string): DenseTextKind | undefined {
  const trimmed = value.trim()
  if (DATA_URI_BASE64.test(trimmed)) return 'base64'
  if (/<svg(?:\s|>)/i.test(trimmed) && /<\/(?:svg)>/i.test(trimmed)) {
    return 'svg'
  }
  if (trimmed.length >= 128 && LONG_BASE64_RUN.test(trimmed)) {
    LONG_BASE64_RUN.lastIndex = 0
    return 'encoded-run'
  }
  LONG_BASE64_RUN.lastIndex = 0
  return undefined
}

/** Estimate the token burden that the ordinary rough estimator misses. */
export function estimateDenseTextTokens(value: string): number {
  const kind = classifyDenseText(value)
  if (!kind) return 0

  if (kind === 'base64') {
    const payload = value.slice(value.indexOf(',') + 1)
    return Math.ceil(payload.length / 3)
  }

  if (kind === 'svg') {
    // Markup and path data tokenize more densely than ordinary prose.
    return Math.ceil(value.length / 2.5)
  }

  let denseChars = 0
  for (const match of value.matchAll(LONG_BASE64_RUN)) denseChars += match[0].length
  LONG_BASE64_RUN.lastIndex = 0
  return Math.ceil(denseChars / 3)
}

function collectStrings(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    output.push(value)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, output)
    return
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) collectStrings(item, output)
  }
}

/** Walk message content without coupling this utility to the Message union. */
export function estimateDenseTextTokensInMessages(messages: readonly unknown[]): number {
  let total = 0
  for (const message of messages) {
    const strings: string[] = []
    collectStrings(message, strings)
    for (const value of strings) total += estimateDenseTextTokens(value)
  }
  return total
}

