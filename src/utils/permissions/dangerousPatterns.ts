/**
 * Pattern lists for dangerous shell-tool allow-rule prefixes.
 *
 * These interpreter and runner names are used to avoid suggesting broad
 * PowerShell permission prefixes that would allow arbitrary code execution.
 */

/**
 * Cross-platform code-execution entry points present on both Unix and Windows.
 * Shared to prevent the two lists drifting apart on interpreter additions.
 */
export const CROSS_PLATFORM_CODE_EXEC = [
  // Interpreters
  'python',
  'python3',
  'python2',
  'node',
  'deno',
  'tsx',
  'ruby',
  'perl',
  'php',
  'lua',
  // Package runners
  'npx',
  'bunx',
  'npm run',
  'yarn run',
  'pnpm run',
  'bun run',
  // Shells reachable from both (Git Bash / WSL on Windows, native on Unix)
  'bash',
  'sh',
  // Remote arbitrary-command wrapper (native OpenSSH on Win10+)
  'ssh',
] as const

export const DANGEROUS_BASH_PATTERNS: readonly string[] = [
  ...CROSS_PLATFORM_CODE_EXEC,
  'zsh',
  'fish',
  'eval',
  'exec',
  'env',
  'xargs',
  'sudo',
  // Anthropic internal: ant-only tools plus general tools that ant sandbox
  // dotfile data shows are commonly over-allowlisted as broad prefixes.
  // These stay ant-only — external users don't have coo, and the rest are
  // an empirical-risk call grounded in ant sandbox data, not a universal
  // "this tool is unsafe" judgment. PS may want these once it has usage data.
  ...(process.env.USER_TYPE === 'ant'
    ? [
        'fa run',
        // Cluster code launcher — arbitrary code on the cluster
        'coo',
        // Network/exfil: gh gist create --public, gh api arbitrary HTTP,
        // curl/wget POST. gh api needs its own entry — the matcher is
        // exact-shape, not prefix, so pattern 'gh' alone does not catch
        // rule 'gh api:*' (same reason 'npm run' is separate from 'npm').
        'gh',
        'gh api',
        'curl',
        'wget',
        // git config core.sshCommand / hooks install = arbitrary code
        'git',
        // Cloud resource writes (s3 public buckets, k8s mutations)
        'kubectl',
        'aws',
        'gcloud',
        'gsutil',
      ]
    : []),
]
