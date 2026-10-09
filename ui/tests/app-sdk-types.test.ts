import { expect, it } from 'bun:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

it('type-checks SDK root and execution subpath contracts without skipLibCheck', () => {
  const fixture = fileURLToPath(new URL('../../packages/app-sdk/test/execution-contract.mts', import.meta.url))
  const program = ts.createProgram([fixture], {
    noEmit: true, strict: true, skipLibCheck: false,
    module: ts.ModuleKind.NodeNext, target: ts.ScriptTarget.ES2022,
    types: ['node'],
  })
  expect(ts.formatDiagnostics(ts.getPreEmitDiagnostics(program), {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => process.cwd(),
    getNewLine: () => '\n',
  })).toBe('')
})
