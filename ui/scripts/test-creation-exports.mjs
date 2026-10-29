import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ui = fileURLToPath(new URL('..', import.meta.url))
const output = path.resolve(ui, '../output/creation-apps'), rendered = path.join(output, 'office-rendered')
const require = createRequire(path.resolve(ui, '../../moss-apps/apps/pdf-tools/package.json'))
const { getDocument } = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')))
const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-creation-office-'))
const run = promisify(execFile), files = []
const soffice = process.env.LIBREOFFICE_EXECUTABLE || (process.platform === 'darwin' ? '/Applications/LibreOffice.app/Contents/MacOS/soffice' : 'soffice')
try {
  await fs.mkdir(rendered, { recursive: true })
  for (const [name, pages, required] of [['项目周报.docx', 1, ['本周成果', '完成创作能力改造']], ['季度预算.xlsx', 2, ['收入', '120000', '42,000']], ['季度汇报.pptx', 2, ['本季度业务结果', '下一步计划']]]) {
    const source = path.join(output, 'exports', name), pdf = path.join(rendered, path.parse(name).name + '.pdf')
    await fs.rm(pdf, { force: true })
    await run(soffice, ['-env:UserInstallation=' + pathToFileURL(profile).href, '--headless', '--convert-to', 'pdf', '--outdir', rendered, source], { timeout: 120000 })
    const document = await getDocument({ data: new Uint8Array(await fs.readFile(pdf)) }).promise
    try {
      assert.equal(document.numPages, pages, name)
      let text = ''
      for (let i = 1; i <= pages; i++) text += (await (await document.getPage(i)).getTextContent()).items.map(item => item.str).join('')
      for (const value of required) assert.ok(text.includes(value), name + ' missing ' + value + ': ' + text)
    } finally { await document.destroy() }
    await run('pdftoppm', ['-png', '-scale-to', '1500', pdf, path.join(rendered, path.parse(name).name)], { timeout: 60000 })
    files.push({ source, sha256: createHash('sha256').update(await fs.readFile(source)).digest('hex'), rendered: pdf, pages })
    console.log('PASS native Office export:', name, pages, 'pages')
  }
  for (const [name, expected] of [['文档.pdf', '本次共接入六个内置 App'], ['排版报告.pdf', '中文字体和文档排版验证']]) {
    const source = path.join(output, 'exports', name), document = await getDocument({ data: new Uint8Array(await fs.readFile(source)) }).promise
    try {
      assert.equal(document.numPages, 1)
      const text = (await (await document.getPage(1)).getTextContent()).items.map(item => item.str).join('')
      assert.ok(text.includes(expected), text)
    } finally { await document.destroy() }
    await run('pdftoppm', ['-png', '-scale-to', '1500', source, path.join(rendered, path.parse(name).name)], { timeout: 60000 })
    files.push({ source, sha256: createHash('sha256').update(await fs.readFile(source)).digest('hex'), pages: 1 })
    console.log('PASS Chinese PDF export:', name)
  }
  await fs.writeFile(path.join(output, 'native-validation.json'), JSON.stringify({ ok: true, engine: 'Local LibreOffice with isolated temporary profile; Poppler page rendering and PDF.js text/page verification', files }, null, 2))
} finally { await fs.rm(profile, { recursive: true, force: true, maxRetries: 5 }) }
