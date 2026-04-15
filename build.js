#!/usr/bin/env bun
/**
 * 构建脚本：读取 features.js，生成 bun build 命令
 * 用法：bun run build.js [--target=node]
 */
import { RECOMMENDED, EXPERIMENTAL, NATIVE_REQUIRED } from './features.js'
import { spawnSync } from 'child_process'

const onlyNode = process.argv.includes('--target=node')

const enabledFeatures = Object.entries({ ...RECOMMENDED, ...EXPERIMENTAL, ...NATIVE_REQUIRED })
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
    '--alias=bun:bundle=./bun-bundle-feature.js',
    ...defines,
  ])
}

// cli-node.js（node target，测试 / electron-sdk 子进程用）
build('cli-node.js', [
  'build', 'src/entrypoints/cli.tsx',
  '--outfile=cli-node.js',
  '--target=node',
  '--alias=bun:bundle=./bun-bundle-feature.js',
  ...defines,
])

// electron-direct.mjs（供 Electron 主进程直接 import，无子进程）
build('electron-direct.mjs', [
  'build', 'src/electron-direct.ts',
  '--outfile=electron-direct.mjs',
  '--target=node',
  '--format=esm',
  '--alias=bun:bundle=./bun-bundle-feature.js',
  ...defines,
])
