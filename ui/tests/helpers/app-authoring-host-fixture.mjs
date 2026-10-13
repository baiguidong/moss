import fs from 'node:fs/promises'
import path from 'node:path'
import { writeJson } from '../../src/apps/app-authoring-source.mjs'

// Self-contained UI + Backend; its build copies only the SDK exported by Core.
export async function writeHostFixture(project) {
  const root = project.path
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  await writeJson(path.join(root, 'app.moss.json'), {
    schemaVersion: 2, id: project.appId, version: '0.1.0', displayName: 'Host preview fixture', hostApi: '^3.4.0',
    navigation: { location: 'more', viewId: 'home' },
    contributes: { views: [{ id: 'home', title: 'Home', route: '#/' }] },
    permissions: ['platform:files'], host: { protocols: ['moss.platform/v1', 'moss.apps/v1'] },
    ui: { entry: 'dist/index.html' },
    backend: { entry: 'dist/main.mjs', runtime: 'node', apiVersion: 1, lifecycle: 'on-demand', actions: [{ name: 'write', inputSchema: 'schemas/write.json' }] },
  })
  await writeJson(path.join(root, 'schemas/write.json'), { type: 'object', required: ['value'], properties: { value: { type: 'string', minLength: 1 } }, additionalProperties: false })
  await writeJson(path.join(root, 'package.json'), { name: project.appId, type: 'module', scripts: { build: 'node build.mjs' } })
  await fs.writeFile(path.join(root, 'src/main.mjs'), `import fs from 'node:fs/promises';import {AppBackendClient} from './sdk/packages/app-sdk/src/index.mjs';
const b=new AppBackendClient();b.registerAction('write',async({value},context)=>{const file=await b.host.request('moss.platform/v1','file.materialize',{fileName:'preview.txt',dataBase64:Buffer.from(value).toString('base64')});return {value:await fs.readFile(file.path,'utf8'),path:file.path,appId:context.appId,dataDir:context.dataDir}});b.start();`)
  await fs.writeFile(path.join(root, 'src/index.html'), `<!doctype html><title>Host preview</title><input id="value"><button id="write">Save</button><output id="result"></output><script type="module">import {createAppClient} from './sdk/packages/app-sdk/src/ui/index.mjs';const c=createAppClient(window.mossApp);document.querySelector('#write').onclick=async()=>{try{const r=await c.actions.invoke('write',{value:document.querySelector('#value').value});document.querySelector('#result').textContent=r.value}catch(e){document.querySelector('#result').textContent=e.message}};</script>`)
  await fs.writeFile(path.join(root, 'build.mjs'), "import fs from 'node:fs/promises';await fs.mkdir('dist',{recursive:true});await fs.cp('.moss-sdk','dist/sdk',{recursive:true});for(const f of ['main.mjs','index.html'])await fs.copyFile('src/'+f,'dist/'+f);")
}
