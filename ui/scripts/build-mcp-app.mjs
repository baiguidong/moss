import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const source = new URL('../src/apps/mcp-app-ui/', import.meta.url)
const output = new URL('../dist/mcp-app/', import.meta.url)
await fs.mkdir(output, { recursive: true })
await build({
  entryPoints: [fileURLToPath(new URL('main.tsx', source))],
  outfile: fileURLToPath(new URL('main.js', output)),
  bundle: true, platform: 'browser', format: 'esm', jsx: 'automatic',
  target: 'chrome132', minify: true, define: { 'process.env.NODE_ENV': '"production"' },
})
await fs.copyFile(new URL('index.html', source), new URL('index.html', output))
