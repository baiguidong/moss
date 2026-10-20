import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const bunTests = [];
const nodeTests = [];

function collect(directory) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const name = join(directory, entry.name);
    if (entry.isDirectory()) collect(name);
    else if (entry.isFile() && /\.test\.(?:mjs|tsx?)$/.test(entry.name)) {
      const source = readFileSync(join(root, name), 'utf8');
      const runner = /\bfrom ['"]node:test['"]|\brequire\(['"]node:test['"]\)/.test(source) ? nodeTests : bunTests;
      runner.push(relative(root, join(root, name)));
    }
  }
}

collect('tests');
collect('src');
bunTests.sort();
nodeTests.sort();
nodeTests.push('tests/app-session-source-host.node.mjs', 'tests/session-persistence.node.mjs', 'tests/desktop-control.node.mjs');

function run(command, args) {
  const result = spawnSync(command, args, { cwd: root, stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}

run('bun', ['test', '--timeout', '30000', ...bunTests]);
run(process.execPath, ['--test', ...nodeTests]);
