import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// Check runtime bindings independently of the repository's incomplete type
// declarations. Include desktop JavaScript, which the root tsconfig omits.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = [...new Set(execFileSync('git', [
  'ls-files', '--cached', '--others', '--exclude-standard', '-z',
], { cwd: root, encoding: 'utf8' }).split('\0'))].filter(file =>
  /^(src|server\/src|ui\/(src|scripts)|admin\/src|packages|scripts|shared)\//.test(file)
  && /\.[cm]?[jt]sx?$/.test(file)
  && !/\.d\.[cm]?ts$/.test(file)
  && !/(^|\/)(__tests__|fixtures)\/|\.(test|spec)\.[cm]?[jt]sx?$/.test(file)
);
const configPath = path.join(root, 'tsconfig.json');
const config = ts.readConfigFile(configPath, ts.sys.readFile);
if (config.error) throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText, '\n'));
const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root);
const program = ts.createProgram(files.map(file => path.join(root, file)), {
  ...parsed.options,
  allowJs: true,
  checkJs: true,
  noEmit: true,
  skipLibCheck: true,
  target: ts.ScriptTarget.ESNext,
  lib: ['lib.esnext.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
});
const runtimeNameCodes = new Set([2304, 2552, 18004, 2448, 2693]);
const buildMacros = new Set([...readFileSync(path.join(root, 'scripts/build.js'), 'utf8')
  .matchAll(/--define=MACRO\.([A-Z_]+)=/g)].map(match => match[1]));

function isTypeOnlyOrBuildMacro(source, position) {
  const token = ts.getTokenAtPosition(source, position);
  for (let node = token; node && node !== source; node = node.parent) {
    if (ts.isTypeNode(node) || ts.isJSDoc(node)) return true;
  }
  // typeof an undeclared identifier is safe at runtime.
  if (ts.isTypeOfExpression(token.parent)) return true;
  return ts.isIdentifier(token) && token.text === 'MACRO'
    && ts.isPropertyAccessExpression(token.parent)
    && token.parent.expression === token
    && buildMacros.has(token.parent.name.text);
}

let count = 0;
for (const file of files) {
  const source = program.getSourceFile(path.join(root, file));
  if (!source) continue;
  for (const diagnostic of program.getSemanticDiagnostics(source)) {
    if (!runtimeNameCodes.has(diagnostic.code)) continue;
    if (isTypeOnlyOrBuildMacro(source, diagnostic.start ?? 0)) continue;
    const location = source.getLineAndCharacterOfPosition(diagnostic.start ?? 0);
    console.error(`${file}:${location.line + 1}:${location.character + 1}: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')}`);
    count++;
  }
}
console.log(`Checked ${files.length} source files; ${count} unresolved runtime bindings.`);
process.exitCode = count > 0 ? 1 : 0;
