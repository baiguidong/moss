import { isAppResourceUri } from '../../shared/app-resource-uri.mjs';
import { visualizationAnnotationBridge } from './visualization-annotation-bridge';

export const VISUALIZATION_CHANNEL = 'moss.visualization/v1';
export function parseVisualizationReference(code: string): { resourceUri: string; title: string } | null {
  try {
    const value = JSON.parse(code);
    if (!value || typeof value.resource_uri !== 'string' || value.resource_uri.length > 4096 || !isAppResourceUri(value.resource_uri)) return null;
    return { resourceUri: value.resource_uri, title: typeof value.title === 'string' ? value.title.slice(0, 120) : '交互可视化' };
  } catch { return null; }
}
export function boundedVisualizationState(value: unknown): unknown {
  try { const json = JSON.stringify(value ?? null); return new TextEncoder().encode(json).length <= 16384 ? JSON.parse(json) : null; } catch { return null; }
}
// Executed inside an opaque-origin frame; no host filesystem or model access.
function visualizationBridge(channel: string, token: string, initialState: unknown, dark: boolean) {
  let state = initialState, failed = false;
  const send = (type: string, payload: unknown) => parent.postMessage({ channel, token, type, payload }, '*');
  Object.defineProperty(window, 'mossVisualization', { value: Object.freeze({
    getState: () => state,
    setState: (value: unknown) => { const json = JSON.stringify(value ?? null); if (new TextEncoder().encode(json).length > 16384) throw new Error('交互状态最多 16 KiB'); state = JSON.parse(json); send('state', state); },
    requestFollowUp: (prompt: string) => { if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 4000) throw new Error('问题需要 1–4000 字'); dispatchEvent(new CustomEvent('moss:follow-up', { detail: { prompt } })); },
  }) });
  const theme = (value: boolean) => { document.documentElement.style.colorScheme = value ? 'dark' : 'light'; };
  theme(dark);
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.channel !== channel || event.data?.token !== token) return;
    if (event.data.type === 'state') { state = event.data.payload; dispatchEvent(new CustomEvent('moss:state', { detail: state })); }
    if (event.data.type === 'theme') theme(event.data.payload === true);
  });
  addEventListener('error', event => { failed = true; send('error', String(event.message).slice(0, 400)); });
  addEventListener('unhandledrejection', event => { failed = true; send('error', String(event.reason).slice(0, 400)); });
  addEventListener('DOMContentLoaded', () => {
    let previous = 0;
    const measure = () => { const height = Math.ceil(document.body.getBoundingClientRect().height + 32); if (height !== previous) { previous = height; send('resize', height); } };
    new ResizeObserver(measure).observe(document.body); measure(); if (!failed) send('ready', null);
  });
}
export function isolatedVisualizationDocument(content: string, options: { token?: string; state?: unknown; dark?: boolean } = {}) {
  const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src data: blob:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";
  const args = JSON.stringify([VISUALIZATION_CHANNEL, options.token || '', boundedVisualizationState(options.state), options.dark || false]).replace(/</g, '\\u003c');
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{color-scheme:light dark}body{margin:16px;font:14px/1.6 system-ui,sans-serif;color:light-dark(#202b23,#e4ece5);background:transparent}*{box-sizing:border-box}img,svg,canvas{max-width:100%}button,input,select,textarea{font:inherit}button{cursor:pointer}html[data-moss-annotating=element] *,html[data-moss-annotating=region] *{cursor:crosshair!important;user-select:none!important}html[data-moss-annotating=text] *{cursor:text!important;user-select:text!important}</style><script>(${visualizationAnnotationBridge.toString()})(...${args});(${visualizationBridge.toString()})(...${args})</script></head><body>${content}</body></html>`;
}
