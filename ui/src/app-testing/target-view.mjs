import WebSocket from 'ws';
import { probeTarget } from './instance.mjs';

async function connect(target) {
  const page = await probeTarget(target.endpoint, target.id, AbortSignal.timeout(3000));
  if (!page?.webSocketDebuggerUrl) throw new Error('测试实例页面尚未就绪。');
  const socket = new WebSocket(page.webSocketDebuggerUrl, { handshakeTimeout: 3000, maxPayload: 8 * 1024 * 1024 });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
  return socket;
}

async function command(socket, method, params = {}) {
  const id = Math.floor(Math.random() * 0x7fffffff);
  return await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new Error('测试实例响应超时。')); }, 5000);
    const receive = data => {
      let value;
      try { value = JSON.parse(String(data)); } catch { return; }
      if (value.id !== id) return;
      cleanup();
      if (value.error) reject(new Error(value.error.message || '测试实例操作失败。'));
      else resolve(value.result);
    };
    const fail = error => { cleanup(); reject(error); };
    const cleanup = () => { clearTimeout(timer); socket.off('message', receive); socket.off('error', fail); socket.off('close', fail); };
    socket.on('message', receive); socket.once('error', fail); socket.once('close', fail);
    socket.send(JSON.stringify({ id, method, params }), error => { if (error) fail(error); });
  });
}

async function withTarget(target, callback) {
  if (!target?.isAlive()) throw new Error('请先打开测试实例。');
  const socket = await connect(target);
  try { return await callback(socket); } finally { socket.close(); }
}

export async function captureTargetFrame(target) {
  return withTarget(target, async socket => {
    const metrics = await command(socket, 'Page.getLayoutMetrics');
    const shot = await command(socket, 'Page.captureScreenshot', { format: 'jpeg', quality: 65, fromSurface: true, captureBeyondViewport: false });
    return { image: `data:image/jpeg;base64,${shot.data}`, width: metrics.cssVisualViewport.clientWidth,
      height: metrics.cssVisualViewport.clientHeight };
  });
}

export async function sendTargetInput(target, input) {
  if (!input || !['click', 'scroll', 'text', 'key'].includes(input.type)) throw new Error('未知测试实例输入。');
  if (['click', 'scroll'].includes(input.type) && (!Number.isFinite(input.x) || !Number.isFinite(input.y))) throw new Error('测试实例坐标无效。');
  if (input.type === 'text' && (typeof input.text !== 'string' || input.text.length > 1000)) throw new Error('测试实例文本无效。');
  if (input.type === 'key' && (typeof input.key !== 'string' || !input.key)) throw new Error('测试实例按键无效。');
  return withTarget(target, async socket => {
    if (input.type === 'click') {
      const position = { x: input.x, y: input.y, button: 'left', clickCount: input.count === 2 ? 2 : 1 };
      await command(socket, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...position });
      await command(socket, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...position });
    } else if (input.type === 'scroll') {
      await command(socket, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: input.x, y: input.y,
        deltaX: input.deltaX || 0, deltaY: input.deltaY || 0 });
    } else if (input.type === 'text') {
      await command(socket, 'Input.insertText', { text: input.text });
    } else if (input.type === 'key') {
      const parameters = { key: input.key, code: input.code || input.key, windowsVirtualKeyCode: input.keyCode || 0,
        modifiers: input.modifiers || 0 };
      await command(socket, 'Input.dispatchKeyEvent', { type: 'keyDown', ...parameters });
      await command(socket, 'Input.dispatchKeyEvent', { type: 'keyUp', ...parameters });
    } else throw new Error('未知测试实例输入。');
    return { ok: true };
  });
}
