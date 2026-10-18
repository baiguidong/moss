// Three sequential pairs; includes prep, scripts, model review, diagnosis and report writes.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
const [packageRoot, settingsFile, outputDirectory, firstSelfRoot] = process.argv.slice(2);
assert(packageRoot && settingsFile && outputDirectory, 'Usage: <package> <settings.json> <output-dir> [completed-first-self-root]');
await fs.mkdir(outputDirectory, { recursive: true });
const results = [];
async function execute(script, extra = []) {
  const child = spawn(process.execPath, [script, packageRoot, settingsFile, ...extra], { stdio: ['ignore','pipe','inherit'] });
  let root, buffer = '';
  child.stdout.on('data', bytes => { process.stdout.write(bytes); buffer += bytes; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) { const match = line.match(/(?:SELF_TEST_APP|DIRECT_REFERENCE): artifacts (.+)/); if (match) root = match[1]; } });
  const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('exit',resolve); });
  assert.equal(code, 0, script + ' failed'); assert(root, 'Missing run output'); return root;
}
async function measure(root, mode) {
  const run = JSON.parse(await fs.readFile(path.join(root, mode === 'self' ? 'run.json' : 'report.json')));
  const report = await fs.stat(mode === 'self' ? run.reportHtmlPath : path.join(root, 'report.html'));
  const ended = Math.max(run.finishedAt, report.mtimeMs, run.benchmarkFinishedAt || 0);
  return { root, runId: run.id, mode, totalMs: Math.round(ended - run.startedAt), preparationMs: run.environmentReadyAt - run.startedAt,
    caseIds: run.cases.map(test => test.id), model: run.model, packageHash: run.selfTestPackageHash, catalogRevision: run.catalogRevision,
    counts: Object.values(run.results).reduce((out, result) => { out[result.status] = (out[result.status] || 0) + 1; return out; }, {}),
    unreviewed: Object.entries(run.results).filter(([,result]) => !result.recordedAt).map(([id]) => id),
    reviews: run.controllerSessions.length, diagnoses: run.controllerSessions.filter(item => item.stage === 'diagnosis').length,
    executionMs: Object.values(run.results).reduce((sum,result) => sum + (result.executionMs || 0),0) };
}
for (let pair = 1; pair <= 3; pair++) {
  const self = await measure(pair === 1 && firstSelfRoot ? firstSelfRoot : await execute('ui/scripts/test-self-test-real.mjs', ['--default']), 'self');
  const reference = await measure(await execute('ui/scripts/test-self-test-reference.mjs'), 'reference');
  assert.deepEqual(self.caseIds, reference.caseIds); assert.equal(self.model, reference.model); assert.equal(self.packageHash, reference.packageHash); assert.equal(self.catalogRevision, reference.catalogRevision);
  results.push({ pair, self, reference, ratio: self.totalMs / reference.totalMs });
  await fs.writeFile(path.join(outputDirectory, 'pairs.json'), JSON.stringify(results, null, 2));
  console.log(`PAIR ${pair}: self ${self.totalMs}ms / reference ${reference.totalMs}ms = ${results.at(-1).ratio.toFixed(3)}`);
}
const median = values => [...values].sort((a,b) => a-b)[Math.floor(values.length / 2)];
const summary = { pairs: results.length, medianRatio: median(results.map(pair => pair.ratio)), medianSelfMs: median(results.map(pair => pair.self.totalMs)),
  medianReferenceMs: median(results.map(pair => pair.reference.totalMs)), threshold: 1.2,
  fullyReviewed: results.every(pair => !pair.self.unreviewed.length && !pair.reference.unreviewed.length),
  withinTimeThreshold: median(results.map(pair => pair.ratio)) <= 1.2,
  acceptancePassed: median(results.map(pair => pair.ratio)) <= 1.2 && results.every(pair => !pair.self.unreviewed.length && !pair.reference.unreviewed.length) && new Set(results.flatMap(pair => [pair.self.packageHash, pair.reference.packageHash])).size === 1 };
await fs.writeFile(path.join(outputDirectory, 'summary.json'), JSON.stringify(summary, null, 2));
console.log('BENCHMARK ' + JSON.stringify(summary));
