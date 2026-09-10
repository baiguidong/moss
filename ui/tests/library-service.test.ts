import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

test('Library service behavior in Node', async () => {
  const outdir = await mkdtemp(join(tmpdir(), 'moss-library-service-test-'));
  try {
    const entrypoint = join(dirname(fileURLToPath(import.meta.url)), 'library-service.node.mjs');
    const build = await Bun.build({
      entrypoints: [entrypoint],
      outdir,
      target: 'node',
      format: 'esm',
    });
    expect(build.success).toBe(true);
    const output = build.outputs[0];
    if (!output) throw new Error('Node Library service test did not build');
    const process = Bun.spawn(['node', '--no-warnings', '--test', output.path], {
      stdout: 'pipe',
      stderr: 'pipe',
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    expect(stderr).toBe('');
    expect(exitCode, stdout).toBe(0);
  } finally {
    await rm(outdir, { recursive: true, force: true });
  }
}, 20_000);
