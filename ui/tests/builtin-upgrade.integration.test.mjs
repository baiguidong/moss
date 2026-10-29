import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

// Real immutable packages, registry publication, runtime state and conditional rollback.
test('builtin upgrades and activation rollback preserve actual installation data', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'moss-builtin-upgrade-'))
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs/promises'; import path from 'node:path';
    import { AppRuntimeHost, writePackageChecksums } from ${JSON.stringify(new URL('../../packages/app-runtime/src/index.mjs', import.meta.url).href)};
    import { verifyBuiltinInstallation, publishBuiltinPackage } from ${JSON.stringify(new URL('../src/apps/builtin-apps.mjs', import.meta.url).href)};
    import { publishAppFromBuild, listAppsFromRegistry, listAppVersions, getAppInstallationRevision, rollbackAppInstallationIfCurrent } from ${JSON.stringify(new URL('../src/app-platform.mjs', import.meta.url).href)};
    const home=process.env.MOSS_HOME, id='fixture.builtin-upgrade';
    const runtime=new AppRuntimeHost({rootDir:home,requireTrustedPublisher:false});await runtime.initialize();
    const installed=()=>listAppsFromRegistry().find(app=>app.id===id);
    const dependencies={runtime,publish:publishAppFromBuild,activate:async(app,grants)=>runtime.registerInstalled(id,app.currentVersion,grants?{grants}:{}),rollback:rollbackAppInstallationIfCurrent,getRevision:getAppInstallationRevision,getInstalled:installed};
    const packages=[];
    try {
      for (const version of ['1.0.0','1.1.0','1.2.0']) {
        const dir=path.join(home,'inputs',version);await fs.mkdir(dir,{recursive:true});
        await fs.writeFile(path.join(dir,'app.moss.json'),JSON.stringify({schemaVersion:2,id,version,displayName:'Upgrade fixture',hostApi:'^3.0.0',ui:{entry:'index.html'},permissions:['local-files:pick']}));
        await fs.writeFile(path.join(dir,'index.html'),'<p>'+version+'</p>');await writePackageChecksums(dir);packages.push(dir);
      }
      const options=()=>({reason:'builtin',expectedBaseVersion:installed()?.currentVersion||null,expectedInstallationRevision:getAppInstallationRevision(id)});
      await publishBuiltinPackage(packages[0],options(),dependencies);
      await runtime.setAppEnabled(id,false);await runtime.setAppGrants(id,[]);await runtime.toolScopeSettings({appId:id,assertCurrent(){}},'session','on-demand');
      const instance=runtime.instances.list(id)[0]; const payload=path.join(home,'apps-data',id,'user-report.txt');await fs.mkdir(path.dirname(payload),{recursive:true});await fs.writeFile(payload,'keep my report');
      assert.equal(await verifyBuiltinInstallation(installed(),listAppVersions(id)),true);
      await publishBuiltinPackage(packages[1],options(),dependencies);
      assert.equal(installed().currentVersion,'1.1.0');assert.equal(runtime.getInstallation(id).activeVersion,'1.1.0');
      assert.equal(runtime.getInstallation(id).enabled,false);assert.deepEqual(runtime.getInstallation(id).grants,[]);
      assert.equal(runtime.getToolScope(id),'session');assert.equal(runtime.instances.list(id)[0].id,instance.id);assert.equal(await fs.readFile(payload,'utf8'),'keep my report');
      await assert.rejects(publishBuiltinPackage(packages[2],options(),{...dependencies,activate:async(app,grants)=>{await dependencies.activate(app,grants);throw new Error('post-activation failure')}}),/post-activation failure/);
      assert.equal(installed().currentVersion,'1.1.0');assert.equal(runtime.getInstallation(id).activeVersion,'1.1.0');assert.equal(runtime.getInstallation(id).enabled,false);assert.deepEqual(runtime.getInstallation(id).grants,[]);
      assert.equal(listAppVersions(id).length,3);assert.equal(await fs.readFile(payload,'utf8'),'keep my report');
      await fs.appendFile(path.join(installed().versionDir,'index.html'),'local edit');await assert.rejects(verifyBuiltinInstallation(installed(),listAppVersions(id)),/Checksum mismatch/);
      console.log(JSON.stringify({upgraded:true,rollback:true,preserved:['disabled','grants','scope','instance','user files','old versions'],localEditProtected:true}));
    } finally { await runtime.shutdown(); }
  `
  try {
    const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, MOSS_HOME: root, MOSS_CONFIG_DIR: root }, timeout: 30000 })
    assert.equal(JSON.parse(stdout.trim()).rollback, true)
  } finally { await fs.rm(root, { recursive: true, force: true }) }
})
