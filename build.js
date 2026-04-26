#!/usr/bin/env bun
/**
 * 构建脚本：读取 features.js，生成 bun build 命令
 * 用法：bun run build.js [--target=node]
 */
import { RECOMMENDED, EXPERIMENTAL, NATIVE_REQUIRED, INTERNAL_ONLY } from './features.js'
import { spawnSync } from 'child_process'

const onlyNode = process.argv.includes('--target=node')

const enabledFeatures = Object.entries({ ...RECOMMENDED, ...EXPERIMENTAL, ...NATIVE_REQUIRED, ...INTERNAL_ONLY })
  .filter(([, v]) => v)
  .map(([k]) => k)

const defines = [
  `--define=MACRO.VERSION="2.1.88"`,
  `--define=MACRO.PACKAGE_URL="@anthropic-ai/claude-code"`,
  `--define=MACRO.NATIVE_PACKAGE_URL="@anthropic-ai/claude-code"`,
  `--define=MACRO.BUILD_TIME="${new Date().toISOString()}"`,
  `--define=MACRO.FEEDBACK_CHANNEL=""`,
  `--define=MACRO.ISSUES_EXPLAINER=""`,
  `--define=MACRO.VERSION_CHANGELOG=""`,
]

const aliases = [
  '--alias=bun:bundle=./bun-bundle-feature.js',
  '--alias=@ant/claude-for-chrome-mcp=./vendor/@ant/claude-for-chrome-mcp/index.js',
  '--alias=@anthropic-ai/bedrock-sdk=./vendor/@anthropic-ai/bedrock-sdk/index.mjs',
  '--alias=@anthropic-ai/foundry-sdk=./vendor/@anthropic-ai/foundry-sdk/index.mjs',
  '--alias=@anthropic-ai/vertex-sdk=./vendor/@anthropic-ai/vertex-sdk/index.mjs',
  '--alias=@anthropic-ai/mcpb=./vendor/@anthropic-ai/mcpb/index.mjs',
  '--alias=modifiers-napi=./vendor/modifiers-napi/index.js',
]

function build(label, args) {
  console.log(`\nBuilding ${label}`)
  const result = spawnSync('bun', args, { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log(`Enabled features (${enabledFeatures.length}): ${enabledFeatures.join(', ') || '(none)'}`)

if (!onlyNode) {
  // cli.js（bun target，生产用）
  build('cli.js', [
    'build', 'src/entrypoints/cli.tsx',
    '--outfile=cli.js',
    '--target=bun',
    ...aliases,
    ...defines,
  ])
}

// cli-node.js（node target，测试 / electron-sdk 子进程用）
build('cli-node.js', [
  'build', 'src/entrypoints/cli.tsx',
  '--outfile=cli-node.js',
  '--target=node',
  ...aliases,
  ...defines,
])

// electron-direct.mjs（供 Electron 主进程直接 import，无子进程）
build('electron-direct.mjs', [
  'build', 'src/electron-direct.ts',
  '--outfile=electron-direct.mjs',
  '--target=node',
  '--format=esm',
  ...aliases,
  ...defines,
])

// admin/dist（由 moss server 直接挂载到 /admin）
build('admin/dist', [
  'run',
  '--cwd', 'admin',
  'build',
])

// moss-server.mjs（统一服务端入口）
build('moss-server.mjs', [
  'build', 'src/server/serverCli.ts',
  '--outfile=moss-server.mjs',
  '--target=node',
  '--format=esm',
  ...aliases,
  ...defines,
])

//direct-connect-session-runner.mjs（session detached runner）
build('direct-connect-session-runner.mjs', [
  'build', 'src/server/sessionRunnerCli.ts',
  '--outfile=direct-connect-session-runner.mjs',
  '--target=node',
  '--format=esm',
  ...aliases,
  ...defines,
])

// direct-connect-open.mjs（独立 headless 客户端入口）
// build('direct-connect-open.mjs', [
//   'build', 'src/server/openCli.ts',
//   '--outfile=direct-connect-open.mjs',
//   '--target=node',
//   '--format=esm',
//   ...aliases,
//   ...defines,
// ])
