import { readFile } from 'fs/promises'
import { SessionRunnerDaemon } from './sessionRunnerDaemon.js'
import type { RunnerManifest } from './types.js'

export async function main(argv: string[] = process.argv): Promise<void> {
  const manifestPath = argv[2]
  if (!manifestPath) {
    throw new Error('Missing runner manifest path')
  }

  const raw = await readFile(manifestPath, 'utf8')
  const manifest = JSON.parse(raw) as RunnerManifest
  if (manifest.session.runtime.configDir) {
    process.env.MOSS_CONFIG_DIR = manifest.session.runtime.configDir
  }

  const daemon = new SessionRunnerDaemon(manifest)
  await daemon.start()
}
