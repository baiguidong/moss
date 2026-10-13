// Run with Electron: native-control.electron.mjs --package=/path/to/package
// Uses an isolated installation. --host-trust verifies the original package
// signature against the Host keys; --load-only skips target input/capture.
import { app, BrowserWindow, ipcMain, powerMonitor, shell } from 'electron';
import fs from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { AppRuntimeHost } from '../../packages/app-runtime/src/host/index.mjs';
import { createAppSignaturePayload, writePackageChecksums } from '../../packages/app-runtime/src/packages/index.mjs';
import { createDesktopControlFeature } from '../src/desktop-control/feature.mjs';
import { loadAppTrustConfiguration } from '../src/apps/app-trust.mjs';

const source = process.argv.find(arg => arg.startsWith('--package='))?.slice(10);
if (!source) throw new Error('--package is required');
const useHostTrust = process.argv.includes('--host-trust');
const loadOnly = process.argv.includes('--load-only');
const root = mkdtempSync(path.join(os.tmpdir(),'moss-native-electron-'));
app.setPath('userData', path.join(root,'user-data'));
app.commandLine.appendSwitch('disable-gpu');
let runtime, window, target;
let targetPid;
const targetBundleId = 'ai.moss.native-migration-test';
let settings = { enabled:false, apps:[{bundleId:targetBundleId,name:'Moss migration test'}] };
const feature = createDesktopControlFeature({ app, ipcMain, powerMonitor, shell, getMainWindow:() => window, getRuntime:() => runtime,
  getSettings:() => settings, saveSettings:value => {settings=value;}, publish() {}, expectedBundleId:'com.github.Electron' });
const timeout = setTimeout(() => { console.error('Native integration timed out', root); app.exit(1); }, 120000);
void (async () => { try {
  const fixture = useHostTrust ? source : path.join(root,'fixture');
  if (!useHostTrust) await fs.cp(source,fixture,{recursive:true});
  const manifest = JSON.parse(await fs.readFile(path.join(fixture,'app.moss.json'),'utf8'));
  let trustedPublishers;
  if (useHostTrust) {
    ({ trustedPublishers } = loadAppTrustConfiguration(fileURLToPath(new URL('../resources/app-market/', import.meta.url))));
  } else {
    const checksums = await writePackageChecksums(fixture), {publicKey,privateKey} = generateKeyPairSync('ed25519');
    const metadata = {schemaVersion:1,algorithm:'ed25519',publisherId:manifest.publisher.id,keyId:'isolated-test'};
    await fs.writeFile(path.join(fixture,'app-signature.json'),JSON.stringify({...metadata,signature:sign(null,createAppSignaturePayload(manifest,checksums,metadata),privateKey).toString('base64')}));
    trustedPublishers = {[manifest.publisher.id]:{'isolated-test':publicKey.export({type:'spki',format:'pem'})}};
  }
  await app.whenReady();
  runtime = new AppRuntimeHost({rootDir:path.join(root,'host'),nativeAdapterHost:feature,
    nativePublishers:useHostTrust ? ['moss'] : [manifest.publisher.id], trustedPublishers});
  await runtime.initialize(); await runtime.installFromDirectory(fixture);
  const pkg = await runtime.getActivePackage(manifest.id), instance = await runtime.ensureDefaultInstance(manifest.id);
  assert.equal(pkg.trust.status,'trusted');
  assert.equal(runtime.nativeAvailable(pkg),true);
  await fs.writeFile(path.join(root,'trust.json'),JSON.stringify(pkg.trust,null,2));
  const preload = path.join(root,'preload.cjs');
  await fs.writeFile(preload, `const {contextBridge,ipcRenderer}=require('electron'); contextBridge.exposeInMainWorld('mossApp',{app:{getInfo:async()=>({appearance:{themeMode:'light',cssThemeId:'grid-theme'}})},host:{request:(protocol,method,input)=>ipcRenderer.invoke('native-smoke:request',{protocol,method,input}),cancel:async()=>{}},events:{on:()=>()=>{}}});`);
  window = new BrowserWindow({width:1040,height:800,show:false,webPreferences:{preload,contextIsolation:true,sandbox:true}});
  ipcMain.handle('native-smoke:request',async (event,{protocol,method,input}) => {
    assert.equal(event.sender,window.webContents); assert.equal(event.senderFrame,window.webContents.mainFrame);
    try { return {ok:true,result:await runtime.requestHostCapability(manifest.id,instance.id,protocol,method,input)}; }
    catch(error) {return {ok:false,error:{message:error.message}};}
  });
  await window.loadFile(path.join(pkg.root,manifest.ui.entry));
  const read = script => window.webContents.executeJavaScript(script);
  for (let i=0;i<50;i++) {
    if ((await read(`document.getElementById('phase').textContent`)) === '控制已关闭') break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  assert.equal(await read(`document.getElementById('phase').textContent`),'控制已关闭');
  assert.equal(await read(`document.getElementById('error').hidden`),true);
  await fs.writeFile(path.join(root,'settings.png'),(await window.webContents.capturePage()).toPNG());
  const enabled = await runtime.requestHostCapability(manifest.id,instance.id,'moss.host/v1','native.settings',{operation:'enable',enabled:true});
  await fs.writeFile(path.join(root,'status.json'),JSON.stringify(enabled,null,2));
  assert.equal(enabled.permissions?.hostIdentity,true,enabled.error);
  const session = {id:'isolated-native-test',title:'Native migration test',appIds:[manifest.id],sessionKind:'chat',originChannel:'desktop',agentMode:'local'};
  const invoke = request => runtime.invokeToolContribution(`${manifest.id}/computer_use`,{request},{sessionRecord:session,signal:new AbortController().signal});
  assert.equal((await invoke({action:'status'})).format,'moss.tool-result/v1');
  if (loadOnly) {
    console.log('NATIVE_LOAD_PASSED: package signature, adapter startup, host identity and status tool');
  } else if (process.platform === 'win32') {
    assert.equal(enabled.phase, 'ready', enabled.error);
    const valueFile = path.join(root, 'windows-input.txt');
    const script = `Add-Type -AssemblyName System.Windows.Forms
$form = New-Object System.Windows.Forms.Form
$form.Text = 'Moss Windows control test'
$form.Width = 700
$form.Height = 360
$text = New-Object System.Windows.Forms.TextBox
$text.AccessibleName = 'Moss Windows input'
$text.Left = 60
$text.Top = 120
$text.Width = 540
$text.Add_TextChanged({ [System.IO.File]::WriteAllText('${valueFile.replaceAll("'", "''")}', $text.Text) })
$form.Controls.Add($text)
[System.Windows.Forms.Application]::Run($form)`;
    target = spawn(path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-STA', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], { windowsHide: true, stdio: 'ignore' });
    await new Promise((resolve, reject) => { target.once('error', reject); setTimeout(resolve, 3000); });
    const appsResult = await invoke({ action: 'list_apps' });
    const apps = JSON.parse(appsResult.content.find(c => c.type === 'text').text).apps;
    const targetApp = apps.find(a => a.running && /powershell\.exe/i.test(a.name));
    assert.ok(targetApp, JSON.stringify(apps));
    settings = { ...settings, apps: [{ bundleId: targetApp.bundleId, name: targetApp.name }] };
    const result = await invoke({ action: 'list_windows', app: targetApp.bundleId });
    const windows = JSON.parse(result.content.find(c => c.type === 'text').text).windows;
    const match = windows.find(w => w.pid === target.pid && JSON.stringify(w).includes('Moss Windows control test'));
    assert.ok(match, JSON.stringify(windows));
    const observed = await invoke({ action: 'get_window_state', app: targetApp.bundleId, window_id: String(match.window_id) });
    const image = observed.content.find(c => c.type === 'image');
    assert.ok(image?.data, 'Windows screenshot was not returned');
    await fs.writeFile(path.join(root, 'windows-window.png'), Buffer.from(image.data, 'base64'));
    const state = JSON.parse(observed.content.find(c => c.type === 'text').text);
    await fs.writeFile(path.join(root, 'observation.json'), JSON.stringify(state, null, 2));
    const input = state.elements?.find(e => JSON.stringify(e).includes('Moss Windows input'));
    assert.ok(input?.element_token, JSON.stringify(state));
    const typed = await invoke({ action: 'type_text', app: targetApp.bundleId, window_id: String(match.window_id), snapshot_id: state.snapshot_id, element_token: input.element_token, text: 'Moss Windows 测试 123' });
    assert.ok(!typed.isError, JSON.stringify(typed));
    for (let i = 0; i < 30; i++) {
      if ((await fs.readFile(valueFile, 'utf8').catch(() => '')).replace(/^\uFEFF/, '') === 'Moss Windows 测试 123') break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal((await fs.readFile(valueFile, 'utf8')).replace(/^\uFEFF/, ''), 'Moss Windows 测试 123');
    await invoke({ action: 'end_session' });
    console.log('WINDOWS_NATIVE_INPUT_PASSED: signed Host load, UI Automation, window capture and Chinese input');
  } else if (enabled.permissions.accessibility && enabled.permissions.screenRecording) {
    // Cua intentionally omits its host from discoverable desktop targets. Use
    // a temporary AppKit application with its own identity and observable input.
    const bundle = path.join(root,'MossMigrationTest.app'), binary = path.join(bundle,'Contents/MacOS/Test');
    const valueFile = path.join(root,'typed-value.txt');
    await fs.mkdir(path.dirname(binary),{recursive:true});
    await fs.writeFile(path.join(bundle,'Contents/Info.plist'),`<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>${targetBundleId}</string><key>CFBundleName</key><string>Moss Migration Test</string><key>CFBundleExecutable</key><string>Test</string><key>CFBundlePackageType</key><string>APPL</string></dict></plist>`);
    const swift = path.join(root,'Test.swift');
    await fs.writeFile(swift, `import AppKit
class Handler: NSObject, NSTextFieldDelegate {
  func controlTextDidChange(_ notification: Notification) {
    let field = notification.object as! NSTextField
    try? field.stringValue.write(toFile: CommandLine.arguments[1], atomically: true, encoding: .utf8)
  }
}
let app = NSApplication.shared
app.setActivationPolicy(.regular)
app.mainMenu = NSMenu()
app.finishLaunching()
let window = NSWindow(contentRect:NSRect(x:240,y:240,width:700,height:360),styleMask:[.titled,.closable],backing:.buffered,defer:false)
window.title = "Moss native control test"
let field = NSTextField(frame:NSRect(x:60,y:170,width:580,height:40))
field.setAccessibilityLabel("Moss migration input")
field.placeholderString = "Moss migration input"
let handler = Handler(); field.delegate = handler
window.contentView?.addSubview(field)
window.makeKeyAndOrderFront(nil)
app.activate(ignoringOtherApps:true)
app.run()
`);
    execFileSync('xcrun',['swiftc',swift,'-o',binary]); execFileSync('codesign',['--force','--sign','-',bundle],{stdio:'ignore'});
    execFileSync('open',['-n',bundle,'--args',valueFile]);
    target = { kill: () => { if (targetPid) { try { process.kill(targetPid); } catch {} } } };
    await new Promise(resolve=>setTimeout(resolve,2000));
    const windows = await invoke({action:'list_windows',app:targetBundleId});
    const windowState = JSON.parse(windows.content.find(c=>c.type==='text').text);
    const match = windowState.windows?.find(w => JSON.stringify(w).includes('Moss native control test'));
    assert.ok(match,JSON.stringify(windowState));
    targetPid = match.pid;
    const observed = await invoke({action:'get_window_state',app:targetBundleId,window_id:String(match.window_id)});
    const image = observed.content.find(c=>c.type==='image'); assert.ok(image?.data,'Native image result was lost');
    await fs.writeFile(path.join(root,'native-window.png'),Buffer.from(image.data,'base64'));
    const state = JSON.parse(observed.content.find(c=>c.type==='text').text);
    await fs.writeFile(path.join(root,'observation.json'),JSON.stringify(state,null,2));
    const input = state.elements?.find(e => /textfield/i.test(e.role || '') && JSON.stringify(e).includes('Moss migration input'));
    if (input && state.snapshot_id) {
    const typed = await invoke({action:'type_text',app:targetBundleId,window_id:String(match.window_id),snapshot_id:state.snapshot_id,element_token:input.element_token,text:'Moss 迁移测试 123'});
    assert.ok(!typed.isError,JSON.stringify(typed));
    for (let i=0;i<20;i++) { if (await fs.readFile(valueFile,'utf8').catch(()=> '') === 'Moss 迁移测试 123') break; await new Promise(resolve=>setTimeout(resolve,100)); }
    assert.equal(await fs.readFile(valueFile,'utf8'),'Moss 迁移测试 123');
    console.log('NATIVE_INPUT_PASSED: actual AX text input');
    } else {
      // This is an explicitly reported driver degradation, not an input pass.
      assert.equal(state.degraded,true); assert.equal(state.elements_complete,false);
      await assert.rejects(invoke({action:'type_text',app:targetBundleId,window_id:String(match.window_id),snapshot_id:'unobserved',x:150,y:400,text:'must not be delivered'}), /快照/);
      await assert.rejects(fs.access(valueFile));
      console.log('NATIVE_INPUT_NOT_VERIFIED: AX window unresolved; stale pixel input was refused');
    }
    await invoke({action:'end_session'});
    console.log('NATIVE_OBSERVATION_PASSED: installed adapter, exact-window image and lifecycle');
  } else console.log('NATIVE_CONTROL_GRANTS_MISSING: installed adapter and host identity passed; capture/input require macOS grants');
  await runtime.setAppEnabled(manifest.id,false);
  assert.equal(feature.owner,null);
  await assert.rejects(invoke({action:'list_apps'}));
  await runtime.uninstall(manifest.id);
  await fs.access(pkg.root); // Loaded native files are retired until restart.
  console.log(JSON.stringify({result:'NATIVE_APP_INTEGRATION_PASSED',root,hostIdentity:enabled.permissions.hostIdentity,trust:pkg.trust,loadOnly}));
  await runtime.shutdown(); target?.kill(); window.destroy(); clearTimeout(timeout); app.exit(0);
} catch(error) {
  console.error(error,root); target?.kill(); await feature.stop('test-failed').catch(()=>{}); await runtime?.shutdown().catch(()=>{}); clearTimeout(timeout); app.exit(1);
} })();
