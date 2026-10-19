import { expect, spyOn, test } from 'bun:test'
import * as childProcess from 'node:child_process'
import { ripGrep, RipgrepSearchError, RipgrepTimeoutError } from './ripgrep.js'

// Control process termination without creating a huge output file or waiting
// for the production timeout. Successful/no-match paths use real rg elsewhere.
async function withProcessResult(error: Partial<childProcess.ExecFileException>, stdout: string, run: () => Promise<void>) {
  const executionError = Object.assign(new Error('controlled process termination'), error)
  const spy = spyOn(childProcess, 'execFile').mockImplementation(((...args: any[]) => {
    const callback = args.at(-1)
    queueMicrotask(() => {
      if (typeof callback === 'function') {
        if (args[1]?.includes('--version')) callback(null, 'ripgrep 1\n', '')
        else callback(executionError, stdout, '')
      }
    })
    return new childProcess.ChildProcess()
  }) as typeof childProcess.execFile)
  try { await run() } finally { spy.mockRestore() }
}

test('timeout with partial stdout is still an error, and preserves only complete lines', async () => {
  await withProcessResult({ signal: 'SIGKILL' }, 'complete\ntorn', async () => {
    try {
      await ripGrep(['pattern'], '/test', new AbortController().signal)
      throw new Error('should reject')
    } catch (error) {
      expect(error).toBeInstanceOf(RipgrepTimeoutError)
      expect((error as RipgrepTimeoutError).partialResults).toEqual(['complete'])
    }
  })
})

test('buffer exhaustion preserves a newline-terminated last row but never returns success', async () => {
  await withProcessResult({ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'first\nsecond\n', async () => {
    try {
      await ripGrep(['pattern'], '/test', new AbortController().signal)
      throw new Error('should reject')
    } catch (error) {
      expect(error).toBeInstanceOf(RipgrepSearchError)
      expect((error as RipgrepSearchError).partialResults).toEqual(['first', 'second'])
      expect((error as Error).message).toContain('output limit')
    }
  })
})
