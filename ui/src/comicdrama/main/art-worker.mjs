/**
 * 美术生成 Worker (Electron utilityProcess 入口)
 * 逐个分镜调 ComfyUI 生成画面, 边生成边回报真实进度。
 *
 * 消息协议:
 *   in : { type:'start', taskId, projectId, aspect, config, shots:[{id, idx, prompt, seed, recipe?}] }
 *        { type:'stop' }                       // 取消全部(含在途)
 *   out: { type:'progress', taskId, shotId, idx, total, percent }  // percent=-1 表示心跳
 *        { type:'shotDone', taskId, shotId, imagePath }
 *        { type:'shotError', taskId, shotId, error }
 *        { type:'done', taskId }
 *        { type:'error', taskId, error }
 */

import path from 'node:path';
import { generateImage, MissingNodeError } from './comfy.mjs';
import { getShotsDir, dimsFor } from './settings.mjs';

const port = process.parentPort;
let stopped = false;
let currentAbort = null;

function post(msg) { port.postMessage(msg); }

port.on('message', (e) => {
  const msg = e.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'stop') {
    stopped = true;
    try { currentAbort?.abort(); } catch { /* ignore */ }
    return;
  }
  if (msg.type === 'start') {
    run(msg).catch((err) => post({ type: 'error', taskId: msg.taskId, error: err.message }));
  }
});

async function run({ taskId, projectId, aspect, config, shots }) {
  const list = Array.isArray(shots) ? shots : [];
  const total = list.length;
  const dir = getShotsDir(projectId);

  for (let i = 0; i < list.length; i++) {
    if (stopped) { post({ type: 'error', taskId, error: '已取消' }); return; }
    const shot = list[i];
    // 每镜可覆盖画幅: recipe.width/height 优先, 否则由项目 aspect 推导
    const dims = (shot.recipe?.width && shot.recipe?.height)
      ? { width: shot.recipe.width, height: shot.recipe.height }
      : dimsFor(aspect, Number(config?.baseSize) || 512);

    post({ type: 'progress', taskId, shotId: shot.id, idx: i, total, percent: 0 });
    const outPath = path.join(dir, `shot_${String(shot.idx).padStart(3, '0')}.png`);
    currentAbort = new AbortController();
    try {
      await generateImage({
        config,
        positive: shot.prompt || '',
        seed: Number.isFinite(shot.seed) ? shot.seed : Math.floor(Math.random() * 1e9),
        width: dims.width,
        height: dims.height,
        outPath,
        recipe: shot.recipe,
        signal: currentAbort.signal,
        onProgress: (pct) => post({ type: 'progress', taskId, shotId: shot.id, idx: i, total, percent: pct }),
      });
      post({ type: 'shotDone', taskId, shotId: shot.id, imagePath: outPath });
    } catch (err) {
      const msg = err instanceof MissingNodeError ? err.message : err.message;
      post({ type: 'shotError', taskId, shotId: shot.id, error: msg });
    } finally {
      currentAbort = null;
    }
  }

  post({ type: 'done', taskId });
}
