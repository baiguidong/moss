import { describe, expect, test } from 'bun:test'
import { migrateLegacyCompletionSourceLines } from '../completionCache.js'

describe('shell completion cache migration', () => {
  test('replaces generated legacy source lines', () => {
    const legacyPath = '/home/test/.claude/completion.zsh'
    const mossPath = '/home/test/.moss/completion.zsh'
    const content = [
      '# Claude Code shell completions',
      `[[ -f "${legacyPath}" ]] && source "${legacyPath}"`,
      'export KEEP_ME=1',
    ].join('\n')

    expect(
      migrateLegacyCompletionSourceLines(content, legacyPath, mossPath),
    ).toBe(
      [
        '# Claude Code shell completions',
        `[[ -f "${mossPath}" ]] && source "${mossPath}"`,
        'export KEEP_ME=1',
      ].join('\n'),
    )
  })

  test('supports tilde and HOME legacy paths without changing other lines', () => {
    const content = [
      'source ~/.claude/completion.bash',
      'source $HOME/.claude/completion.bash',
      'CACHE=~/.claude/completion.bash',
    ].join('\n')

    expect(
      migrateLegacyCompletionSourceLines(
        content,
        '/home/test/.claude/completion.bash',
        '/custom/moss/completion.bash',
      ),
    ).toBe(
      [
        'source /custom/moss/completion.bash',
        'source /custom/moss/completion.bash',
        'CACHE=~/.claude/completion.bash',
      ].join('\n'),
    )
  })
})
