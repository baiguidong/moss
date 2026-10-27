import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeBundledPaths } from './sanitize-build-paths.mjs'

test('absolute dependency paths are portable without corrupting regexes before module comments', () => {
  const source = `const grammar = { begin: /"/, end: /"/ };
// /private/tmp/build/node_modules/highlight.js/lib/languages/actionscript.js
const filename = "/Users/build agent/repo/node_modules/undici/index.js";
const directory = '/opt/build/node_modules/@aws-sdk/client-s3';
return { grammar, filename, directory };`
  const result = new Function(sanitizeBundledPaths(source))()
  assert.equal(result.grammar.begin.source, '"')
  assert.equal(result.grammar.end.source, '"')
  assert.equal(result.filename, './node_modules/undici/index.js')
  assert.equal(result.directory, './node_modules/@aws-sdk/client-s3')
  assert.match(sanitizeBundledPaths(source), /\/\/ \/private\/tmp\/build\/node_modules\/highlight\.js/)
})
