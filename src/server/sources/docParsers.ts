/**
 * Document Center v2 — Document parsers.
 *
 * Convert binary office formats (docx/pdf/xlsx/pptx) to markdown so the
 * wiki-builder agent (and embedding-based retrieval, eventually) can
 * read them as plain text.
 *
 * Strategy:
 *   1. `.docx` → mammoth (pure-JS, fast, preserves headings/lists/images)
 *      Dynamically imported so moss runs without the dep installed.
 *   2. `.pdf`  → pdf-parse (pure-JS, no system deps).
 *      Same dynamic-import pattern.
 *   3. `.xlsx`/`.pptx` and anything else mammoth/pdf-parse don't handle
 *      → call `libreoffice --headless --convert-to txt` if available on
 *      PATH. Falls back to "binary, skipped" if libreoffice is missing.
 *
 * All parsers are best-effort and never throw past this module — failures
 * return null and the caller (WikiJobExecutor.prepareInputs) staging
 * loop keeps going.
 */

import { execFile } from 'child_process'
import { promisify } from 'util'
import { readFile, writeFile, rm, mkdir } from 'fs/promises'
import { tmpdir } from 'os'
import path from 'path'
import { randomUUID } from 'crypto'

const execFileAsync = promisify(execFile)

export type ParseResult = {
  /** UTF-8 markdown content suitable for direct write into wiki input/ */
  markdown: string
  /** Files generated alongside (e.g. extracted images) for the caller to also write. */
  attachments?: Array<{ name: string; bytes: Buffer }>
  /** Parser identifier (for debugging / meta logs). */
  via: 'passthrough' | 'mammoth' | 'pdf-parse' | 'libreoffice'
}

/**
 * Convert a document to markdown. Returns null if no available parser
 * recognises the extension or if conversion failed.
 */
export async function parseDocument(
  filePath: string,
  fileName: string,
): Promise<ParseResult | null> {
  const ext = path.extname(fileName).toLowerCase()

  if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
    const content = await readFile(filePath, 'utf8').catch(() => null)
    if (content == null) return null
    return { markdown: content, via: 'passthrough' }
  }

  if (ext === '.docx') {
    const r = await parseDocxWithMammoth(filePath).catch(() => null)
    if (r) return r
    // mammoth missing or threw — fall through to libreoffice
  }

  if (ext === '.pdf') {
    const r = await parsePdfWithPdfParse(filePath).catch(() => null)
    if (r) return r
  }

  // Generic libreoffice fallback handles .doc/.xlsx/.pptx/.odt/.rtf and
  // also serves as the second-attempt path for .docx/.pdf above.
  return parseWithLibreOffice(filePath, fileName).catch(() => null)
}

async function parseDocxWithMammoth(filePath: string): Promise<ParseResult | null> {
  let mammoth: typeof import('mammoth') | null
  try {
    mammoth = (await import('mammoth')) as typeof import('mammoth')
  } catch {
    return null
  }
  if (!mammoth) return null

  // convertToMarkdown returns { value, messages }
  const result = await mammoth.convertToMarkdown({ path: filePath })
  const markdown = String(result?.value ?? '').trim()
  if (!markdown) return null
  return { markdown, via: 'mammoth' }
}

async function parsePdfWithPdfParse(filePath: string): Promise<ParseResult | null> {
  let pdfParse: ((data: Buffer) => Promise<{ text: string }>) | null
  try {
    const mod = (await import('pdf-parse')) as { default?: unknown } & Record<string, unknown>
    const candidate =
      (typeof mod === 'function' ? mod : null) ??
      (typeof mod.default === 'function' ? (mod.default as unknown) : null)
    pdfParse = candidate as ((data: Buffer) => Promise<{ text: string }>) | null
  } catch {
    return null
  }
  if (!pdfParse) return null

  const bytes = await readFile(filePath)
  const out = await pdfParse(bytes)
  const text = String(out?.text ?? '').trim()
  if (!text) return null
  return { markdown: text, via: 'pdf-parse' }
}

async function parseWithLibreOffice(
  filePath: string,
  fileName: string,
): Promise<ParseResult | null> {
  // LibreOffice can convert to markdown directly on modern releases; we
  // ask for txt for max compatibility, then prepend a single H1 derived
  // from the file name so chunks have at least one heading.
  const sofficeBin = process.env.LIBREOFFICE_BIN || 'soffice'

  // Make a temp work dir so concurrent jobs don't collide on output names.
  const workDir = path.join(tmpdir(), `moss-conv-${randomUUID()}`)
  await mkdir(workDir, { recursive: true })

  try {
    await execFileAsync(sofficeBin, [
      '--headless',
      '--convert-to',
      'txt:Text (encoded):UTF8',
      '--outdir',
      workDir,
      filePath,
    ], { timeout: 60_000 })
  } catch (err) {
    // Either soffice is missing, or it errored. Either way, can't proceed.
    return null
  }

  const baseName = path.basename(fileName, path.extname(fileName))
  const outPath = path.join(workDir, `${baseName}.txt`)

  let text: string
  try {
    text = await readFile(outPath, 'utf8')
  } catch {
    return null
  } finally {
    // Best-effort cleanup; tmp will get GC'd anyway.
    rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }

  const trimmed = text.trim()
  if (!trimmed) return null

  const title = baseName.replace(/[_-]+/g, ' ')
  return {
    markdown: `# ${title}\n\n${trimmed}\n`,
    via: 'libreoffice',
  }
}

/**
 * Convenience: parse a doc and write the markdown (+ any attachments)
 * into `outDir`. Returns the relative file path written, or null on
 * failure.
 */
export async function parseAndWrite(
  filePath: string,
  fileName: string,
  outDir: string,
): Promise<{ writtenPath: string; via: ParseResult['via'] } | null> {
  const parsed = await parseDocument(filePath, fileName)
  if (!parsed) return null

  const baseName = path.basename(fileName, path.extname(fileName))
  const mdName = `${baseName}.md`
  const mdPath = path.join(outDir, mdName)

  await writeFile(mdPath, parsed.markdown, 'utf8')

  if (parsed.attachments) {
    for (const a of parsed.attachments) {
      await writeFile(path.join(outDir, a.name), a.bytes)
    }
  }

  return { writtenPath: mdPath, via: parsed.via }
}
