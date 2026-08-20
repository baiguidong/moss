import * as directRuntime from '../src/electron-direct.js'
import { registerDirectRuntimeModule } from '../server/src/backends/directEmbeddedBackend.js'
import { main as runSessionRunnerCli } from '../server/src/sessionRunnerCli.js'

registerDirectRuntimeModule(directRuntime)

await runSessionRunnerCli(process.argv).catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack || error.message : String(error)}\n`,
  )
  process.exit(1)
})
