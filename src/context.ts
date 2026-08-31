import memoize from 'lodash-es/memoize.js'
import { getAdditionalDirectoriesForMossMd } from './bootstrap/state.js'
import { getLocalISODate } from './constants/common.js'
import {
  getAutoMemEntrypointCacheKey,
  getMossMds,
  getMemoryFiles,
} from './utils/mossmd.js'
import { getCwd } from './utils/cwd.js'
import { logForDiagnosticsNoPII } from './utils/diagLogs.js'
import { getMossConfigHomeDir, isBareMode } from './utils/envUtils.js'
import { execFileNoThrow } from './utils/execFileNoThrow.js'
import { getIsGit, gitExe } from './utils/git.js'
import { shouldIncludeGitInstructions } from './utils/gitSettings.js'
import { logError } from './utils/log.js'

const MAX_STATUS_CHARS = 2000

export const getGitStatus = memoize(async (): Promise<string | null> => {
  if (process.env.NODE_ENV === 'test') {
    // Avoid cycles in tests
    return null
  }

  const startTime = Date.now()
  logForDiagnosticsNoPII('info', 'git_status_started')

  const isGitStart = Date.now()
  const isGit = await getIsGit()
  logForDiagnosticsNoPII('info', 'git_is_git_check_completed', {
    duration_ms: Date.now() - isGitStart,
    is_git: isGit,
  })

  if (!isGit) {
    logForDiagnosticsNoPII('info', 'git_status_skipped_not_git', {
      duration_ms: Date.now() - startTime,
    })
    return null
  }

  try {
    const gitCmdsStart = Date.now()
    // Branch and default branch are resolved with direct git commands (which
    // run in the ALS cwd) instead of getBranch()/getDefaultBranch(): those go
    // through the process-global single-repo gitWatcher cache, which would
    // serve another concurrent session's repo state.
    const [branch, mainBranch, status, log, userName] = await Promise.all([
      // branch --show-current reads the HEAD symref, so it works in
      // freshly-initialized repos with no commits (empty only on detached HEAD).
      execFileNoThrow(
        gitExe(),
        ['--no-optional-locks', 'branch', '--show-current'],
        { preserveOutputOnError: false, useCwd: true },
      ).then(({ stdout }) => stdout.trim()),
      (async () => {
        const { stdout } = await execFileNoThrow(
          gitExe(),
          [
            '--no-optional-locks',
            'symbolic-ref',
            '--short',
            'refs/remotes/origin/HEAD',
          ],
          { preserveOutputOnError: false, useCwd: true },
        )
        const symref = stdout.trim().replace(/^origin\//, '')
        if (symref) return symref
        for (const candidate of ['main', 'master']) {
          const ref = await execFileNoThrow(
            gitExe(),
            [
              '--no-optional-locks',
              'rev-parse',
              '--verify',
              '--quiet',
              `refs/remotes/origin/${candidate}`,
            ],
            { preserveOutputOnError: false, useCwd: true },
          )
          if (ref.stdout.trim()) return candidate
        }
        return 'main'
      })(),
      execFileNoThrow(gitExe(), ['--no-optional-locks', 'status', '--short'], {
        preserveOutputOnError: false,
        useCwd: true,
      }).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(
        gitExe(),
        ['--no-optional-locks', 'log', '--oneline', '-n', '5'],
        {
          preserveOutputOnError: false,
          useCwd: true,
        },
      ).then(({ stdout }) => stdout.trim()),
      execFileNoThrow(gitExe(), ['config', 'user.name'], {
        preserveOutputOnError: false,
        useCwd: true,
      }).then(({ stdout }) => stdout.trim()),
    ])

    logForDiagnosticsNoPII('info', 'git_commands_completed', {
      duration_ms: Date.now() - gitCmdsStart,
      status_length: status.length,
    })

    // Check if status exceeds character limit
    const truncatedStatus =
      status.length > MAX_STATUS_CHARS
        ? status.substring(0, MAX_STATUS_CHARS) +
          '\n... (truncated because it exceeds 2k characters. If you need more information, run "git status" using BashTool)'
        : status

    logForDiagnosticsNoPII('info', 'git_status_completed', {
      duration_ms: Date.now() - startTime,
      truncated: status.length > MAX_STATUS_CHARS,
    })

    return [
      `This is the git status at the start of the conversation. Note that this status is a snapshot in time, and will not update during the conversation.`,
      `Current branch: ${branch}`,
      `Main branch (you will usually use this for PRs): ${mainBranch}`,
      ...(userName ? [`Git user: ${userName}`] : []),
      `Status:\n${truncatedStatus || '(clean)'}`,
      `Recent commits:\n${log}`,
    ].join('\n\n')
  } catch (error) {
    logForDiagnosticsNoPII('error', 'git_status_failed', {
      duration_ms: Date.now() - startTime,
    })
    logError(error)
    return null
  }
  // Keyed by cwd: concurrent embedded sessions run in different working
  // directories and must not share each other's git status.
}, () => getCwd())

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getSystemContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'system_context_started')

    const gitStatus = !shouldIncludeGitInstructions()
      ? null
      : await getGitStatus()

    logForDiagnosticsNoPII('info', 'system_context_completed', {
      duration_ms: Date.now() - startTime,
      has_git_status: gitStatus !== null,
    })

    return {
      ...(gitStatus && { gitStatus }),
    }
  },
  // Keyed by cwd for concurrent embedded sessions.
  () => getCwd(),
)

/**
 * This context is prepended to each conversation, and cached for the duration of the conversation.
 */
export const getUserContext = memoize(
  async (): Promise<{
    [k: string]: string
  }> => {
    const startTime = Date.now()
    logForDiagnosticsNoPII('info', 'user_context_started')

    // --bare: skip auto-discovery (cwd walk), BUT honor explicit --add-dir.
    // --bare means "skip what I didn't ask for", not "ignore what I asked for".
    const shouldDisableMossMd =
      isBareMode() && getAdditionalDirectoriesForMossMd().length === 0
    // Await the async I/O (readFile/readdir directory walk) so the event
    // loop yields naturally at the first fs.readFile.
    const mossMd = shouldDisableMossMd
      ? null
      : getMossMds(await getMemoryFiles())
    logForDiagnosticsNoPII('info', 'user_context_completed', {
      duration_ms: Date.now() - startTime,
      mossmd_length: mossMd?.length ?? 0,
      mossmd_disabled: Boolean(shouldDisableMossMd),
    })

    return {
      ...(mossMd && { mossMd }),
      currentDate: `Today's date is ${getLocalISODate()}.`,
    }
  },
  // Profile and memory state are session-scoped in the embedded runtime.
  () =>
    `${getMossConfigHomeDir()}:${getCwd()}:${getAutoMemEntrypointCacheKey()}:${getAdditionalDirectoriesForMossMd().join('\0')}`,
)
