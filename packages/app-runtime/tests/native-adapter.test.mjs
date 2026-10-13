import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { generateKeyPairSync, sign } from 'node:crypto';
import { AppRuntimeHost } from '../src/host/index.mjs';
import { writePackageChecksums, createAppSignaturePayload } from '../src/packages/index.mjs';
import { validateAppManifest } from '../../app-sdk/src/schemas/index.mjs';

const manifest = { schemaVersion:2, id:'test.native', version:'1.0.0', displayName:'Test Native', hostApi:'^3.2.0', toolScope:'session',
  publisher:{id:'test',name:'Test'}, ui:{entry:'index.html'}, nativeAdapter:{kind:'desktop-control',apiVersion:1,entry:'entry.mjs'}, permissions:['desktop:control'],
  contributes:{tools:[{id:'control',title:'Control',description:'Control test',action:'control',execution:'native',effect:'write',permission:'desktop:control',inputSchema:'input.json',instructions:'prompt.md'}]} };
async function fixture(t, { signed = true, approved = true, failStop = false, loaded = false } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'moss-native-contract-')), source = path.join(root,'source');
  await fs.mkdir(source); const events = [];
  for (const [name, value] of Object.entries({ 'app.moss.json':JSON.stringify(manifest),'index.html':'<h1>Settings</h1>','entry.mjs':'export function createAdapter() {}','prompt.md':'Full instructions','input.json':JSON.stringify({type:'object',properties:{query:{type:'string'}},required:['query'],additionalProperties:false}) })) await fs.writeFile(path.join(source,name), value);
  const checksums = await writePackageChecksums(source), { publicKey, privateKey } = generateKeyPairSync('ed25519');
  if (signed) {
    const meta = {schemaVersion:1,algorithm:'ed25519',publisherId:'test',keyId:'fixture'};
    await fs.writeFile(path.join(source,'app-signature.json'), JSON.stringify({...meta,signature:sign(null,createAppSignaturePayload(manifest,checksums,meta),privateKey).toString('base64')}));
  }
  let installedRoot;
  const runtime = new AppRuntimeHost({rootDir:path.join(root,'host'),trustedPublishers:{test:{fixture:publicKey.export({type:'spki',format:'pem'})}}, nativePublishers:approved ? ['test'] : [],
    nativeAdapterHost: {
      invoke: async (_pkg, _action, input) => { events.push('invoke'); return input; },
      settings: async () => ({ supported:true }), isLoaded: () => loaded, stop: async () => {},
      deactivate: async () => { events.push('stop'); if (installedRoot) await fs.access(path.join(installedRoot,'entry.mjs')); if (failStop) throw new Error('stop failed'); },
    } });
  await runtime.initialize(); await runtime.installFromDirectory(source); installedRoot = (await runtime.getActivePackage(manifest.id)).root;
  t.after(async () => { await runtime.shutdown(); await fs.rm(root,{recursive:true,force:true}); });
  return { runtime, installedRoot, events };
}
test('native manifest requires compatible Host, a publisher, a scoped permission and an adapter', () => {
  const normalized = validateAppManifest(manifest);
  assert.equal(normalized.backend,undefined); assert.equal(normalized.contributes.tools[0].execution,'native');
  for (const patch of [{hostApi:'^3.1.0'},{publisher:undefined},{toolScope:'global'},{nativeAdapter:undefined},{permissions:[]}]) {
    assert.throws(() => validateAppManifest({...manifest,...patch}));
  }
  const spoof = structuredClone(manifest); delete spoof.nativeAdapter; spoof.contributes.tools[0].execution = 'backend'; spoof.contributes.tools[0].hostPermissionManaged = true;
  assert.throws(() => validateAppManifest(spoof), /unknown Backend/);
});
test('only signed and Host-approved native publishers expose control tools', async t => {
  for (const options of [{signed:false},{approved:false},{}]) {
    const { runtime } = await fixture(t, options);
    const tools = (await runtime.listContributions({kinds:['tools'],loadSchemas:true})).tools;
    if (options.signed === false || options.approved === false) { assert.deepEqual(tools,[]); await assert.rejects(runtime.requireNativePackage(manifest.id), /trusted signature/); }
    else {
      assert.equal(tools[0].hostPermissionManaged,true); assert.equal(tools[0].instructionsText,'Full instructions');
      assert.deepEqual(await runtime.invokeToolContribution('test.native/control',{query:'ok'}),{query:'ok'});
      await assert.rejects(runtime.invokeToolContribution('test.native/control',{query:'ok',session:'spoof'}), /schema/);
    }
  }
});
test('installed native bytes are rechecked before dispatch', async t => {
  const { runtime, installedRoot, events } = await fixture(t);
  await fs.writeFile(path.join(installedRoot,'entry.mjs'),'throw new Error("tampered")');
  await assert.rejects(runtime.invokeToolContribution('test.native/control',{query:'test'}), /Checksum mismatch/);
  assert.deepEqual(events,[]);
});
test('disable and grant revocation stay closed when cleanup fails', async t => {
  const { runtime } = await fixture(t,{failStop:true});
  await assert.rejects(runtime.setAppEnabled(manifest.id,false), /stop failed/);
  assert.equal(runtime.installations.get(manifest.id).enabled,false);
  await runtime.installations.upsert(manifest.id,{enabled:true});
  await assert.rejects(runtime.setAppGrants(manifest.id,[]), /stop failed/);
  assert.deepEqual(runtime.installations.get(manifest.id).grants,[]);
  await assert.rejects(runtime.requireNativePackage(manifest.id), /revoked/);
});
test('uninstall stops before deleting files and retains loaded native versions', async t => {
  for (const loaded of [false,true]) {
    const { runtime, installedRoot, events } = await fixture(t,{loaded});
    await runtime.uninstall(manifest.id);
    assert.deepEqual(events,['stop']); assert.equal(runtime.installations.get(manifest.id),null);
    if (loaded) {
      await fs.access(installedRoot);
      await runtime.shutdown();
      const restarted = new AppRuntimeHost({rootDir:runtime.rootDir});
      await restarted.initialize();
      await assert.rejects(fs.access(installedRoot));
      await restarted.shutdown();
    } else await assert.rejects(fs.access(installedRoot));
  }
});
test('App UI can manage native settings without inventing a Node Backend', async t => {
  const { runtime } = await fixture(t);
  const instance = await runtime.ensureDefaultInstance(manifest.id);
  assert.deepEqual(await runtime.requestHostCapability(manifest.id,instance.id,'moss.host/v1','native.settings',{operation:'status'}),{supported:true});
  await assert.rejects(runtime.requestHostCapability(manifest.id,instance.id,'moss.host/v1','native.settings',{operation:'decide'}), /Invalid/);
});
