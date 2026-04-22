import { parseConnectUrl } from './parseConnectUrl.js'
import { runConnectHeadless } from './connectHeadless.js'
import { createDirectConnectSession } from './createDirectConnectSession.js'

function printHelp(): void {
  process.stdout.write(
    [
      'Usage: direct-connect-open <cc-url> [options]',
      '',
      'Options:',
      '  -p, --print <prompt>    Prompt to send immediately',
      '  --output-format <fmt>   text | stream-json (default: text)',
      '  -h, --help              Show this help',
      '',
    ].join('\n'),
  )
}

function parseArgs(argv: string[]): {
  ccUrl: string
  prompt: string
  outputFormat: string
} {
  if (argv.includes('-h') || argv.includes('--help')) {
    printHelp()
    process.exit(0)
  }

  let ccUrl = ''
  let prompt = ''
  let outputFormat = 'text'

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (!ccUrl && !arg.startsWith('-')) {
      ccUrl = arg
      continue
    }
    if (arg === '-p' || arg === '--print') {
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        prompt = next
        i += 1
      }
      continue
    }
    if (arg === '--output-format') {
      outputFormat = argv[i + 1] || outputFormat
      i += 1
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!ccUrl) {
    throw new Error('Missing cc:// URL')
  }
  if (!['text', 'stream-json'].includes(outputFormat)) {
    throw new Error(`Unsupported --output-format: ${outputFormat}`)
  }

  return { ccUrl, prompt, outputFormat }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  const { serverUrl, authToken } = parseConnectUrl(options.ccUrl)
  const session = await createDirectConnectSession({
    serverUrl,
    authToken,
    cwd: process.cwd(),
  })

  await runConnectHeadless(
    session.config,
    options.prompt,
    options.outputFormat,
    true,
  )
}

main().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
})
