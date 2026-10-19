import fs from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAppUiRequestScope } from '../apps/app-ui-requests.mjs';
import { defaultInstanceId } from '../../../packages/app-runtime/src/state/index.mjs';

const rpcMethods = new Set(['app-ui:actions:invoke', 'app-ui:actions:cancel', 'app-ui:host:request', 'app-ui:host:cancel', 'app-ui:host:subscribe', 'app-ui:host:unsubscribe']);
export function createWebApps({ registry, resources, resolveApp, appearance = () => ({}), listVersions, storage, prepareComposer, assertWorkAllowed = () => {} }) {
  const offers = new Map();
  const pages = new Map();
  const opening = new Set();
  let preloadSource;
  async function bootstrap() {
    if (!preloadSource) {
      const desktop = await fs.readFile(new URL('../apps/app-preload.mjs', import.meta.url), 'utf8');
      preloadSource = desktop.slice(desktop.indexOf('function on('));
    }
    return `<script>(()=>{
      let port; const pending=new Map(), listeners=new Map();
      const ready=new Promise(resolve=>window.addEventListener('message',function connect(event){
        if(event.source!==parent || event.data?.type!=='moss:app-port' || !event.ports[0])return;
        window.removeEventListener('message',connect);port=event.ports[0];
        port.onmessage=({data})=>{if(data.type==='event'){for(const fn of listeners.get(data.method)||[])fn({},data.payload);return;}
          const item=pending.get(data.id);if(!item)return;pending.delete(data.id);data.ok?item.resolve(data.value):item.reject(new Error(data.error));};resolve();
      }));
      const ipcRenderer={invoke:async(method,input)=>{await ready;return new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{resolve,reject});port.postMessage({id,method,input});});},
        on:(name,fn)=>{if(!listeners.has(name))listeners.set(name,new Set());listeners.get(name).add(fn);},off:(name,fn)=>listeners.get(name)?.delete(fn)};
      const contextBridge={exposeInMainWorld:(name,value)=>Object.defineProperty(window,name,{value,writable:false,configurable:false})};
      ${preloadSource}
    })();</script>`;
  }
  function dispose(id) { const page = pages.get(id); if (!page) return; page.scope.close(); page.handle.revoke(); pages.delete(id); registry.publish('web:app-closed', { embedId: id }); }
  function validate(page) {
    const current = page.state.runtime.installations.get(page.state.id);
    if (!current?.enabled || current.activeVersion !== page.version) { dispose(page.id); throw new Error('App 已停用或版本已变化，请重新打开。'); }
    return page.state;
  }
  function entry(context, id) {
    const page = pages.get(id);
    if (!page || page.userId !== context.principal?.userId || page.connectionId !== context.connectionId) throw new Error('App 页面已失效，请重新打开。');
    validate(page); return page;
  }
  async function open(context, input, resolved) {
    assertWorkAllowed();
    if (pages.size + opening.size >= 64) throw new Error('打开的 App 页面过多。');
    const pending = { connectionId: context.connectionId, canceled: false }; opening.add(pending);
    let handle;
    try {
    const offer = input.previewRef ? offers.get(input.previewRef) : null;
    if (input.previewRef && (!offer || offer.ownerId !== context.principal.userId)) throw new Error('创作预览已关闭。');
    const state = resolved || offer?.state || await resolveApp(input);
    const installation = state.runtime.installations.get(state.id);
    if (!installation?.enabled) throw new Error('请先启用此 App。');
    if (!state.manifest.ui || !state.entryPath) throw new Error('此 App 没有页面。');
    const id = randomUUID();
    const page = { id, state, userId: context.principal.userId, connectionId: context.connectionId, version: installation.activeVersion };
    handle = await resources.create({ root: state.bundleRoot || path.dirname(state.entryPath), entryPath: state.entryPath, htmlPrefix: await bootstrap(), ownerId: page.userId, validate: () => validate(page) });
    if (pending.canceled || (offer && offers.get(input.previewRef) !== offer)) throw new Error('App 页面已关闭，请重新打开。');
    validate(page);
    const scope = createAppUiRequestScope({ getState: () => validate(page), sourceId: 'web-app-' + id,
      invocation: () => ({ surface: 'app', origin: state.preview ? 'preview' : 'ui', sessionId: state.sessionId, workspace: state.workspace }),
      send: (method, payload) => registry.publish('web:app-event', { embedId: id, method, payload }) });
    Object.assign(page, { handle, scope }); pages.set(id, page);
    return { ok: true, embedId: id, url: handle.url, preload: 'web', app: { id: state.id, name: state.name || state.id, displayName: state.manifest.displayName || state.id, description: state.manifest.description || '' } };
    } catch (error) { handle?.revoke(); throw error; }
    finally { opening.delete(pending); }
  }
  const handlers = new Map([
    ['web:app-preview-list', context => [...offers].filter(([, item]) => item.ownerId === context.principal.userId).map(([id, item]) => ({ id, title: item.state.manifest.displayName || item.state.id }))],
    ['web:app-preview-close', (context, { id }) => { const offer = offers.get(id); if (!offer || offer.ownerId !== context.principal.userId) throw new Error('创作预览已关闭。'); offer.handle.close(); return { ok: true }; }],
    ['app:embedded-open', (context, input) => open(context, input)],
    ['app:embedded-close', (context, { embedId }) => { entry(context, embedId); dispose(embedId); return { ok: true }; }],
    ['web:app-request', async (context, { embedId, method, input = {} }) => {
      assertWorkAllowed();
      const page = entry(context, embedId), state = page.state, runtime = state.runtime;
      if (rpcMethods.has(method)) return page.scope.request(method, input);
      switch (method) {
        case 'app-ui:get-info': return { id: state.id, name: state.name || state.id, kind: 'app', version: page.version, displayName: state.manifest.displayName, description: state.manifest.description, hasUi: true, hasBackend: !!state.manifest.backend, backend: state.manifest.backend || null, permissions: state.manifest.permissions || [], appearance: appearance() };
        case 'app-ui:get-status': return runtime.getInstanceStatus(state.id, defaultInstanceId(state.id));
        case 'app-ui:list-versions': return state.preview ? [] : listVersions(state.id);
        case 'app-ui:get-installation-state': return runtime.getApp(state.id);
        case 'app-ui:instances:list': return runtime.listInstances(state.id);
        case 'app-ui:instances:update': { const { instanceId, ...patch } = input; await runtime.updateInstance(state.id, instanceId, patch); return (await runtime.listInstances(state.id)).find(item => item.id === instanceId); }
        case 'app-ui:instances:set-enabled': return runtime.setInstanceEnabled(state.id, input.instanceId, input.enabled);
        case 'app-ui:instances:clear-credentials': await runtime.clearInstanceCredentials(state.id, input.instanceId); return (await runtime.listInstances(state.id)).find(item => item.id === input.instanceId);
        case 'app-ui:instances:get-status': return runtime.getInstanceStatus(state.id, input.instanceId);
        case 'app-ui:storage:get': case 'app-ui:storage:set': case 'app-ui:storage:remove': case 'app-ui:storage:list': return storage(state, method.split(':').at(-1), input);
        case 'app-ui:composer:prepare': return prepareComposer(state, input);
        default: throw new Error('此 App 无权调用该接口。');
      }
    }],
  ]);
  const unsubscribe = registry.subscribe((method, payload) => {
    if (method === 'app:changed') for (const page of [...pages.values()]) { try { validate(page); } catch {} }
    if (method === 'agent:settings-changed') for (const page of pages.values()) registry.publish('web:app-event', { embedId: page.id, method: 'app-ui:event:appearance', payload: appearance() });
  });
  return { handlers, open, dispose,
    offer(state, ownerId) {
      if (offers.size >= 16) throw new Error('创作预览过多，请先关闭已有预览。');
      const id = randomUUID(), handle = new EventEmitter();
      const timer = setTimeout(() => handle.close(), 24 * 3600_000); timer.unref?.();
      handle.close = () => {
        if (!offers.has(id)) return;
        clearTimeout(timer);
        offers.delete(id);
        for (const page of [...pages.values()]) if (page.state === state) dispose(page.id);
        handle.emit('closed'); registry.publish('web:app-previews-changed', {});
      };
      state = { ...state, preview: true };
      offers.set(id, { state, ownerId, handle });
      registry.publish('web:app-previews-changed', {}); return handle;
    }, closeApp(id) { for (const page of [...pages.values()]) if (page.state.id === id) dispose(page.id); },
    disconnect(connectionId) { for (const pending of opening) if (pending.connectionId === connectionId) pending.canceled = true; for (const page of [...pages.values()]) if (page.connectionId === connectionId) dispose(page.id); },
    publishRuntime(event) { for (const page of pages.values()) if (page.state.id === event.appId) { registry.publish('web:app-event', { embedId: page.id, method: 'app-ui:event:runtime', payload: event }); if (event.name) registry.publish('web:app-event', { embedId: page.id, method: `app-ui:event:${event.name}`, payload: event.data }); } },
    close() { for (const pending of opening) pending.canceled = true; for (const offer of [...offers.values()]) offer.handle.close(); unsubscribe(); for (const id of [...pages.keys()]) dispose(id); } };
}
