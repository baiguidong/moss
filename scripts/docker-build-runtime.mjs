#!/usr/bin/env node
import { spawnSync } from 'child_process'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function usage() {
  return `Usage:
  bun scripts/docker-build-runtime.mjs --tag moss-runtime:0.1.8 --platform linux/arm64 --load
  bun scripts/docker-build-runtime.mjs --tag registry.example.com/moss-runtime:0.1.8 --platform linux/arm64,linux/amd64 --push

Options:
  --tag <image>          Image tag. Default: moss-runtime:0.1.8
  --platform <list>      Build platform list. Default: linux/arm64
  --load                 Load a single-platform image into the local Docker daemon.
  --push                 Push the built image or multi-platform manifest.
  --node-version <ver>   Node.js version. Default: 22.22.1
  --sharp-version <ver>  sharp version. Default: 0.34.5
  --base-image <image>   Ubuntu base image. Default: public.ecr.aws/ubuntu/ubuntu:24.04
  --no-cache             Pass --no-cache to docker buildx build.
  --progress <mode>      Docker progress mode, e.g. auto, plain.
  -h, --help             Show this help.
`
}

function parseArgs(argv) {
  const options = {
    tag: 'moss-runtime:0.1.8',
    platform: 'linux/arm64',
    load: false,
    push: false,
    nodeVersion: '22.22.1',
    sharpVersion: '0.34.5',
    baseImage: 'public.ecr.aws/ubuntu/ubuntu:24.04',
    noCache: false,
    progress: undefined,
  }

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '-h' || arg === '--help') {
      console.log(usage())
      process.exit(0)
    }
    if (arg === '--tag') {
      options.tag = argv[++i] || ''
      continue
    }
    if (arg === '--platform') {
      options.platform = argv[++i] || ''
      continue
    }
    if (arg === '--load') {
      options.load = true
      continue
    }
    if (arg === '--push') {
      options.push = true
      continue
    }
    if (arg === '--node-version') {
      options.nodeVersion = argv[++i] || ''
      continue
    }
    if (arg === '--sharp-version') {
      options.sharpVersion = argv[++i] || ''
      continue
    }
    if (arg === '--base-image') {
      options.baseImage = argv[++i] || ''
      continue
    }
    if (arg === '--no-cache') {
      options.noCache = true
      continue
    }
    if (arg === '--progress') {
      options.progress = argv[++i] || ''
      continue
    }
    throw new Error(`Unknown option: ${arg}`)
  }

  if (!options.tag) throw new Error('Missing --tag value')
  if (!options.platform) throw new Error('Missing --platform value')
  if (!options.nodeVersion) throw new Error('Missing --node-version value')
  if (!options.sharpVersion) throw new Error('Missing --sharp-version value')
  if (!options.baseImage) throw new Error('Missing --base-image value')
  if (options.load && options.push) {
    throw new Error('Choose only one of --load or --push')
  }

  const platforms = options.platform.split(',').map(value => value.trim()).filter(Boolean)
  if (platforms.length === 0) {
    throw new Error('Missing --platform value')
  }
  if (platforms.length > 1 && options.load) {
    throw new Error('--load only supports a single platform. Use --push for multi-platform builds.')
  }
  if (!options.load && !options.push) {
    if (platforms.length === 1) {
      options.load = true
    } else {
      throw new Error('Multi-platform builds require --push')
    }
  }

  return options
}

function run(command, args) {
  console.log(`$ ${[command, ...args].join(' ')}`)
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    env: process.env,
  })
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

try {
  const options = parseArgs(process.argv.slice(2))
  const args = [
    'buildx',
    'build',
    '--platform',
    options.platform,
    '--tag',
    options.tag,
    '--file',
    'docker/runtime/Dockerfile',
    '--build-arg',
    `BASE_IMAGE=${options.baseImage}`,
    '--build-arg',
    `NODE_VERSION=${options.nodeVersion}`,
    '--build-arg',
    `SHARP_VERSION=${options.sharpVersion}`,
  ]
  if (options.noCache) args.push('--no-cache')
  if (options.progress) args.push('--progress', options.progress)
  args.push(options.push ? '--push' : '--load')
  args.push('.')

  run('docker', args)
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  console.error('')
  console.error(usage())
  process.exit(1)
}
