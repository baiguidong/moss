// macOS package acceptance: deny access to both source repositories in the child.
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
const core = fileURLToPath(new URL('../..', import.meta.url))
if (process.platform !== 'darwin') throw new Error('Run the installed SDK acceptance on macOS; Windows requires its own package fixture')
const source = path.join(core, 'ui/dist/installers/mac-arm64/Moss.app')
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-installed-sdk-'))
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options })
  if (result.error || result.status !== 0) throw result.error || new Error(`${command} failed: ${result.stderr}\n${result.stdout}`)
  return result.stdout
}
try {
  const target = path.join(root, 'Moss.app')
  run('cp', ['-cR', source, target])
  const resources = path.join(target, 'Contents/Resources')
  const catalogModule = pathToFileURL(path.join(resources, 'app.asar/src/apps/app-developer-catalog.mjs')).href
  const script = path.join(root, 'verify.mjs')
  await fs.writeFile(script, `import fs from 'node:fs/promises';import {execFileSync} from 'node:child_process';import path from 'node:path';import assert from 'node:assert/strict';import {createDeveloperCatalog} from ${JSON.stringify(catalogModule)};
const root=${JSON.stringify(root)},resources=${JSON.stringify(resources)};
const project=path.join(root,'project');await fs.mkdir(project);const catalog=await createDeveloperCatalog();await catalog.exportTo(project);
const nodeRoot=path.join(root,'node');await fs.mkdir(nodeRoot);execFileSync('/usr/bin/tar',['-xzf',path.join(resources,'runtimes/node-darwin-arm64.tar.gz'),'-C',nodeRoot]);
const node=path.join(nodeRoot,(await fs.readdir(nodeRoot))[0],'bin/node');
await fs.writeFile(path.join(project,'check.mjs'),"import {APP_HOST_API_VERSION} from '@moss/app-sdk';console.log(APP_HOST_API_VERSION)");
assert.equal(execFileSync(node,['check.mjs'],{cwd:project,encoding:'utf8',env:{PATH:path.dirname(node)}}).trim(),'3.0.0');
for(const name of ['assistants/app-builder','skills/convert-skill-to-app']) await assert.rejects(()=>fs.access(path.join(resources,name)));
console.log(JSON.stringify({status:'passed',sourceRepositoriesDenied:true,...catalog.info}));`)
  const profile = `(version 1)(allow default)(deny file-read* (subpath ${JSON.stringify(core)}) (subpath ${JSON.stringify(path.resolve(core, '../moss-apps'))}))`
  const output = run('/usr/bin/sandbox-exec', ['-p', profile, path.join(target, 'Contents/MacOS/Moss'), script], { cwd: root, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', NODE_PATH: '', MOSS_HOME: path.join(root, 'home') } })
  console.log(output.trim())
} finally { await fs.rm(root, { recursive: true, force: true }) }
