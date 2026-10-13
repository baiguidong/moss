// Instrument a temporary copy of the packaged Desktop with the same E2E harness.
// The tested process cannot read either development repository.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { spawn, execFile, execFileSync } from 'node:child_process'
import http from 'node:http'
const require = createRequire(import.meta.url)
const core = fileURLToPath(new URL('../..', import.meta.url))
if (process.platform !== 'darwin') throw new Error('This installed-package isolation harness currently supports macOS')
const mode = process.argv.includes('--agent') ? 'agent' : 'desktop'
const executable = process.env.MOSS_CORE_EXECUTABLE || path.join(core, 'ui/dist/installers/mac-arm64/Moss.app/Contents/MacOS/Moss')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-installed-builder-'))
let processBroker
try {
  const target = path.join(root, 'Moss.app')
  execFileSync('cp', ['-cR', path.resolve(executable, '../../..'), target])
  const resources = path.join(target, 'Contents/Resources'), unpacked = path.join(resources, 'app')
  require('@electron/asar').extractAll(path.join(resources, 'app.asar'), unpacked)
  await fs.rm(path.join(resources, 'app.asar'))
  const metadataFile = path.join(unpacked, 'package.json'), metadata = JSON.parse(await fs.readFile(metadataFile, 'utf8'))
  metadata.main = 'tests/app-builder.electron.mjs'
  await fs.writeFile(metadataFile, JSON.stringify(metadata))
  await fs.mkdir(path.join(unpacked, 'tests'), { recursive: true })
  await fs.copyFile(path.join(core, 'ui/tests/app-builder.electron.mjs'), path.join(unpacked, 'tests/app-builder.electron.mjs'))
  // Seatbelt refuses the system setuid ps executable. A read-only test broker
  // executes exactly the two production process-info queries outside seatbelt.
  processBroker = http.createServer((request, response) => {
    let args
    try { args = JSON.parse(new URL(request.url, 'http://localhost').searchParams.get('args')) } catch {}
    const valid = Array.isArray(args) && (JSON.stringify(args) === JSON.stringify(['-ww', '-axo', 'pid=,command='])
      || (args.length === 9 && /^\d+$/.test(args[2]) && JSON.stringify(args.filter((_, i) => i !== 2)) === JSON.stringify(['-ww', '-p', '-o', 'lstart=', '-o', 'stat=', '-o', 'command='])))
    if (!valid) { response.writeHead(400); response.end(); return }
    execFile('/bin/ps', args, { encoding: 'utf8', timeout: 5000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, LC_ALL: 'C', TZ: 'UTC' } }, (error, stdout, stderr) => {
      response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ stdout, stderr, code: error?.code ?? 0 }))
    })
  })
  await new Promise(resolve => processBroker.listen(0, '127.0.0.1', resolve))
  const endpoint = `http://127.0.0.1:${processBroker.address().port}`
  const processInfo = path.join(resources, 'packages/app-runtime/src/process/process-info.mjs')
  await fs.writeFile(processInfo, (await fs.readFile(processInfo, 'utf8')).replaceAll("execute('/bin/ps',", 'executeProcessInfo(') + `\nasync function executeProcessInfo(args) { const result=await (await fetch(${JSON.stringify(endpoint)}+'/?args='+encodeURIComponent(JSON.stringify(args)))).json(); if(result.code)throw Object.assign(new Error('Process query failed'),result); return result; }\n`)
  const sourceArtifact = path.join(core, '../moss-apps/artifacts/moss.app-builder/0.1.0')
  await fs.cp(sourceArtifact, path.join(root, 'builder'), { recursive: true })
  const completionFile = path.join(root, 'completed.json')
  const env = { ...process.env, MOSS_BUILDER_TEST_MODE: mode, MOSS_BUILDER_PACKAGE: path.join(root, 'builder/package'), MOSS_PACKAGE_ISOLATED: '1', MOSS_BUILDER_TEST_COMPLETION_FILE: completionFile }
  delete env.ELECTRON_RUN_AS_NODE
  if (mode === 'agent') {
    if (!env.MOSS_BUILDER_AGENT_SETTINGS) throw new Error('A configured model is required for the real Agent test')
    const settings = JSON.parse(await fs.readFile(env.MOSS_BUILDER_AGENT_SETTINGS, 'utf8'))
    env.MOSS_BUILDER_AGENT_SETTINGS = path.join(root, 'model.json')
    await fs.writeFile(env.MOSS_BUILDER_AGENT_SETTINGS, JSON.stringify({ models: { text: settings.models?.text } }), { mode: 0o600 })
  }
  const profile = `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(core)}) (subpath ${JSON.stringify(path.resolve(core, '../moss-apps'))}))`
  // macOS does not allow Chromium to install a second seatbelt profile. The
  // outer profile still denies repository reads for the entire process tree.
  const child = spawn('/usr/bin/sandbox-exec', ['-p', profile, path.join(target, 'Contents/MacOS/Moss'), '--no-sandbox', '--disable-gpu'], { cwd: root, env, stdio: 'inherit' })
  const code = await new Promise((resolve, reject) => { child.once('exit', resolve); child.once('error', reject) })
  if (code !== 0) throw new Error(`Installed Builder ${mode} test failed (${code})`)
  const completion = JSON.parse(await fs.readFile(completionFile, 'utf8').catch(() => { throw new Error('Core exited without completing the E2E assertions') }))
  if (completion.status !== 'passed' || completion.mode !== mode) throw new Error('Invalid E2E completion marker')
  console.log(JSON.stringify({ status: 'passed', mode, sourceRepositoriesDenied: true, packagedCore: true, instrumentation: 'test entrypoint and read-only system ps broker' }))
} finally { processBroker?.closeAllConnections(); await new Promise(resolve => processBroker ? processBroker.close(resolve) : resolve()); await fs.rm(root, { recursive: true, force: true }) }
