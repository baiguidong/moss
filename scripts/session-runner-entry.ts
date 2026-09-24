import { registerDirectRuntimeModule } from '../server/src/backends/directEmbeddedBackend.js'
import { main as runSessionRunnerCli } from '../server/src/sessionRunnerCli.js'

// Only the container backend runs the Agent. The host daemon must be able to
// open its control socket without initializing the entire Agent runtime.
if (process.argv[2] === '--stdio') {
  registerDirectRuntimeModule(await import('../src/electron-direct.js'))
}

await runSessionRunnerCli(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  )
  process.exit(1)
})
