import { expect, it } from 'bun:test';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

it('checks Desktop request, result and event contracts at compile time', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const config = ts.readConfigFile(`${root}/tsconfig.json`, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
  const program = ts.createProgram([`${root}/tests/fixtures/desktop-api-contract.ts`], parsed.options);
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
  expect(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name,
    getCurrentDirectory: () => root,
    getNewLine: () => '\n',
  })).toBe('');
});
