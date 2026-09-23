import { basename, join } from 'node:path'

// Isolate the bundler from Bun's test-loader module resolution cache.
export async function buildNodeFixture(options: {
  entrypoints: string[]
  outdir: string
  target: 'node'
  format: 'esm'
}) {
  const entrypoint = options.entrypoints[0]!
  const outputPath = join(
    options.outdir,
    basename(entrypoint).replace(/\.ts$/, '.mjs'),
  )
  const child = Bun.spawn(
    [
      process.execPath,
      'build',
      entrypoint,
      '--target=node',
      '--format=esm',
      `--outfile=${outputPath}`,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [code, , stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (code) throw new Error(stderr)
  return { success: true, outputs: [{ path: outputPath }] }
}
