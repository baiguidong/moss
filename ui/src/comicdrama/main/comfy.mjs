/**
 * ComfyUI 客户端
 * 通过 ComfyUI HTTP + WebSocket API 生成画面:
 *   POST /prompt 提交图 -> WS /ws 真实进度(回退 /history 轮询) -> /view 取图 -> 存盘
 *
 * 图的来源:
 *   - 用户在配置里贴了「API 格式」workflow JSON(含占位符 token): 走 token 替换(逃生舱)
 *   - 否则由 buildGraph(recipe) 用 GraphBuilder 按需装配(默认 text2img)
 *
 * Recipe(装配单位, 由 bridge/worker 组装):
 *   { mode, checkpoint, vae?, positive, negative, seed, steps, cfg, sampler, scheduler,
 *     width, height, init?:{image,denoise}, loras?, controlnets?, ipadapter?, upscale? }
 *
 * 占位符 token(用户自定义 workflow 时可用):
 *   %POSITIVE% %NEGATIVE% %SEED% %WIDTH% %HEIGHT% %STEPS% %CFG% %CKPT% %SAMPLER% %SCHEDULER% %DENOISE%
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

/** 缺失自定义节点时抛出, 供上层转成可操作的安装提示 */
export class MissingNodeError extends Error {
  constructor(nodeType) {
    super(`ComfyUI 缺少节点 ${nodeType}(需安装对应自定义节点)`);
    this.name = 'MissingNodeError';
    this.nodeType = nodeType;
  }
}

function trimUrl(u) {
  return String(u || '').trim().replace(/\/+$/, '');
}

/** http(s):// -> ws(s)://, 用于 /ws 连接 */
function wsBase(httpBase) {
  return httpBase.replace(/^http/i, 'ws');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 图构建器: 维护自增节点 id, 逐节点 add, 最后 build 出 ComfyUI API 格式的 prompt 对象。
 * 每个 add 返回该节点 id(字符串), 供后续节点以 [id, slot] 引用。
 */
class GraphBuilder {
  constructor() { this.nodes = {}; this.seq = 0; }
  add(class_type, inputs) {
    const id = String(++this.seq);
    this.nodes[id] = { class_type, inputs };
    return id;
  }
  build() { return this.nodes; }
}

/** 查询 ComfyUI 已安装的第一个 checkpoint(默认图需要一个真实模型名) */
async function firstCheckpoint(baseUrl) {
  try {
    const resp = await fetch(`${baseUrl}/object_info/CheckpointLoaderSimple`);
    if (!resp.ok) return '';
    const info = await resp.json();
    const list = info?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    return Array.isArray(list) && list.length ? list[0] : '';
  } catch {
    return '';
  }
}

/**
 * 由 recipe 装配 ComfyUI 图。
 * 链路: Checkpoint -> (LoRA 链) -> CLIP 编码(pos/neg) -> (ControlNet 叠加)
 *       -> Latent(空 / VAEEncode 做 img2img) -> KSampler -> VAEDecode -> (放大) -> SaveImage
 */
function buildGraph(recipe) {
  const g = new GraphBuilder();
  const r = recipe;

  // 1) checkpoint
  const ckpt = g.add('CheckpointLoaderSimple', { ckpt_name: r.checkpoint });
  let modelRef = [ckpt, 0];
  let clipRef = [ckpt, 1];
  let vaeRef = [ckpt, 2];

  // 可选独立 VAE
  if (r.vae) {
    const vae = g.add('VAELoader', { vae_name: r.vae });
    vaeRef = [vae, 0];
  }

  // 2) LoRA 链(依次串联, 影响 model 与 clip)
  for (const lora of Array.isArray(r.loras) ? r.loras : []) {
    if (!lora?.name) continue;
    const ln = g.add('LoraLoader', {
      lora_name: lora.name,
      strength_model: Number.isFinite(lora.strength_model) ? lora.strength_model : 1,
      strength_clip: Number.isFinite(lora.strength_clip) ? lora.strength_clip : 1,
      model: modelRef,
      clip: clipRef,
    });
    modelRef = [ln, 0];
    clipRef = [ln, 1];
  }

  // 3) IPAdapter(可选, 需自定义节点; 缺失时提交会报 node_errors 由上层翻译)
  if (r.ipadapter?.image) {
    const ipLoader = g.add('IPAdapterUnifiedLoader', {
      model: modelRef,
      preset: r.ipadapter.preset || 'PLUS (high strength)',
    });
    const ipImg = g.add('LoadImage', { image: r.ipadapter.image });
    const ipApply = g.add('IPAdapter', {
      model: [ipLoader, 0],
      ipadapter: [ipLoader, 1],
      image: [ipImg, 0],
      weight: Number.isFinite(r.ipadapter.weight) ? r.ipadapter.weight : 0.8,
    });
    modelRef = [ipApply, 0];
  }

  // 4) 提示词编码
  const pos = g.add('CLIPTextEncode', { text: r.positive || '', clip: clipRef });
  const neg = g.add('CLIPTextEncode', { text: r.negative || '', clip: clipRef });
  let posCond = [pos, 0];
  let negCond = [neg, 0];

  // 5) ControlNet 叠加(可选, openpose 等; 需模型+预处理自定义节点)
  for (const cn of Array.isArray(r.controlnets) ? r.controlnets : []) {
    if (!cn?.model || !cn?.image) continue;
    const cnLoader = g.add('ControlNetLoader', { control_net_name: cn.model });
    const cnImg = g.add('LoadImage', { image: cn.image });
    const cnApply = g.add('ControlNetApplyAdvanced', {
      positive: posCond,
      negative: negCond,
      control_net: [cnLoader, 0],
      image: [cnImg, 0],
      strength: Number.isFinite(cn.strength) ? cn.strength : 1,
      start_percent: Number.isFinite(cn.start) ? cn.start : 0,
      end_percent: Number.isFinite(cn.end) ? cn.end : 1,
    });
    posCond = [cnApply, 0];
    negCond = [cnApply, 1];
  }

  // 6) latent: img2img(VAEEncode)或 text2img(EmptyLatentImage)
  let latentRef;
  let denoise = 1;
  if (r.mode === 'img2img' && r.init?.image) {
    const initImg = g.add('LoadImage', { image: r.init.image });
    const enc = g.add('VAEEncode', { pixels: [initImg, 0], vae: vaeRef });
    latentRef = [enc, 0];
    denoise = Number.isFinite(r.init.denoise) ? r.init.denoise : 0.6;
  } else {
    const empty = g.add('EmptyLatentImage', { width: r.width, height: r.height, batch_size: 1 });
    latentRef = [empty, 0];
  }

  // 7) 采样
  const ks = g.add('KSampler', {
    seed: r.seed,
    steps: r.steps,
    cfg: r.cfg,
    sampler_name: r.sampler || 'dpmpp_2m',
    scheduler: r.scheduler || 'karras',
    denoise,
    model: modelRef,
    positive: posCond,
    negative: negCond,
    latent_image: latentRef,
  });

  // 8) 解码
  const dec = g.add('VAEDecode', { samples: [ks, 0], vae: vaeRef });
  let imageRef = [dec, 0];

  // 9) 放大(可选, 需放大模型)
  if (r.upscale?.model) {
    const upModel = g.add('UpscaleModelLoader', { model_name: r.upscale.model });
    const up = g.add('ImageUpscaleWithModel', { upscale_model: [upModel, 0], image: imageRef });
    imageRef = [up, 0];
  }

  // 10) 保存
  g.add('SaveImage', { filename_prefix: 'moss_comic', images: imageRef });
  return g.build();
}

/** 把用户 workflow 模板里的占位符替换成实际值(逃生舱) */
function applyTemplate(workflowStr, v) {
  const jsonEscape = (s) => JSON.stringify(String(s)).slice(1, -1);
  const replaced = workflowStr
    .replaceAll('%POSITIVE%', jsonEscape(v.positive))
    .replaceAll('%NEGATIVE%', jsonEscape(v.negative))
    .replaceAll('%SEED%', String(v.seed))
    .replaceAll('%WIDTH%', String(v.width))
    .replaceAll('%HEIGHT%', String(v.height))
    .replaceAll('%STEPS%', String(v.steps))
    .replaceAll('%CFG%', String(v.cfg))
    .replaceAll('%CKPT%', jsonEscape(v.checkpoint))
    .replaceAll('%SAMPLER%', jsonEscape(v.sampler || 'dpmpp_2m'))
    .replaceAll('%SCHEDULER%', jsonEscape(v.scheduler || 'karras'))
    .replaceAll('%DENOISE%', String(v.denoise ?? 1));
  return JSON.parse(replaced);
}

/** 由 config + 单镜参数归一化出一个 recipe */
function normalizeRecipe({ config, positive, negative, seed, width, height, recipe }) {
  const base = {
    mode: 'text2img',
    checkpoint: (config?.checkpoint || '').trim(),
    vae: (config?.vae || '').trim() || undefined,
    positive: positive || '',
    negative: negative != null ? negative : (config?.negativePrompt || ''),
    seed,
    steps: Number(config?.steps) || 12,
    cfg: Number(config?.cfg) || 7,
    sampler: config?.sampler || 'dpmpp_2m',
    scheduler: config?.scheduler || 'karras',
    width,
    height,
  };
  // 每镜 recipe 覆盖(局部覆盖 config 默认)
  return { ...base, ...(recipe || {}) };
}

/**
 * WebSocket 真实进度: 连接 /ws?clientId=, 把 progress{value,max} 折算为百分比回调。
 * 返回 { close() }。连接失败静默(上层有 /history 轮询兜底)。
 */
function openProgressWs(baseUrl, clientId, promptId, onProgress) {
  let ws = null;
  let closed = false;
  try {
    ws = new WebSocket(`${wsBase(baseUrl)}/ws?clientId=${clientId}`);
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return; // 二进制预览帧忽略
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m?.type === 'progress' && m.data) {
        const { value, max, prompt_id } = m.data;
        if (prompt_id && promptId && prompt_id !== promptId) return;
        if (max > 0) onProgress?.(Math.round((value / max) * 100));
      }
    };
    ws.onerror = () => { /* 静默, 轮询兜底 */ };
  } catch { /* WebSocket 不可用则忽略 */ }
  return {
    close() {
      if (closed) return;
      closed = true;
      try { ws?.close(); } catch { /* ignore */ }
    },
  };
}

/** 中断当前执行并从队列删除指定 prompt */
async function interruptComfy(baseUrl, promptId) {
  try { await fetch(`${baseUrl}/interrupt`, { method: 'POST' }); } catch { /* ignore */ }
  if (promptId) {
    try {
      await fetch(`${baseUrl}/queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ delete: [promptId] }),
      });
    } catch { /* ignore */ }
  }
}

/** 判断字符串是否是本地绝对文件路径(用于区分「待上传的本地图」与「ComfyUI 已有文件名」) */
function isLocalPath(s) {
  return typeof s === 'string' && (s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s));
}

/**
 * 上传本地图片到 ComfyUI input 目录, 返回 ComfyUI 用于 LoadImage 的文件名。
 * 用稳定名(路径 hash + 原扩展名)并 overwrite, 使 ComfyUI 重启后再次生成会自动重传覆盖。
 */
export async function uploadImage(baseUrl, absPath, stableName) {
  const buf = await fsp.readFile(absPath);
  const ext = (path.extname(absPath) || '.png').toLowerCase();
  const name = stableName || `moss_${createHash('sha1').update(absPath).digest('hex').slice(0, 16)}${ext}`;
  const form = new FormData();
  form.append('image', new Blob([buf]), name);
  form.append('overwrite', 'true');
  const resp = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form });
  if (!resp.ok) throw new Error(`上传参考图失败 ${resp.status}`);
  const j = await resp.json().catch(() => ({}));
  // ComfyUI 返回 { name, subfolder, type }; LoadImage 用 "subfolder/name" 或 "name"
  return j.subfolder ? `${j.subfolder}/${j.name}` : (j.name || name);
}

/**
 * 把 recipe 里引用的本地图片路径(init/ipadapter/controlnets)上传到 ComfyUI 并改写为其文件名。
 * 就地修改并返回同一 recipe(已归一化的副本)。
 */
async function resolveRecipeImages(baseUrl, recipe) {
  if (!recipe) return recipe;
  const up = async (p) => (isLocalPath(p) ? uploadImage(baseUrl, p) : p);
  if (recipe.init?.image) recipe.init.image = await up(recipe.init.image);
  if (recipe.ipadapter?.image) recipe.ipadapter.image = await up(recipe.ipadapter.image);
  if (Array.isArray(recipe.controlnets)) {
    for (const cn of recipe.controlnets) { if (cn?.image) cn.image = await up(cn.image); }
  }
  return recipe;
}

/**
 * 生成一张画面并写入 outPath
 * @param {object} p
 * @param {object} p.config getComfyConfig() 的结果
 * @param {string} p.positive 正向提示词
 * @param {string} [p.negative] 反向(默认取 config.negativePrompt)
 * @param {number} p.seed
 * @param {number} p.width
 * @param {number} p.height
 * @param {string} p.outPath 输出 png 绝对路径
 * @param {object} [p.recipe] 每镜配方覆盖
 * @param {(pct:number)=>void} [p.onProgress] 单张进度(0-100, -1=心跳)
 * @param {AbortSignal} [p.signal] 取消信号
 */
export async function generateImage({ config, positive, negative, seed, width, height, outPath, recipe, onProgress, signal }) {
  const baseUrl = trimUrl(config?.url);
  if (!baseUrl) throw new Error('ComfyUI 地址未配置');
  if (signal?.aborted) throw new Error('已取消');

  const merged = normalizeRecipe({ config, positive, negative, seed, width, height, recipe });

  // checkpoint 兜底: 配置为空则问 ComfyUI 要第一个(仅默认图需要)
  const tpl = (config?.workflow || '').trim();
  if (!tpl && !merged.checkpoint) {
    merged.checkpoint = await firstCheckpoint(baseUrl);
    if (!merged.checkpoint) {
      throw new Error('ComfyUI 未检测到可用的 checkpoint 模型, 请在 ComfyUI 安装模型或在配置里指定 workflow');
    }
  }

  let workflow;
  if (tpl) {
    workflow = applyTemplate(tpl, merged);
  } else {
    // img2img/参考图/pose 图: 先把本地图上传到 ComfyUI, 改写成其可识别的文件名
    await resolveRecipeImages(baseUrl, merged);
    workflow = buildGraph(merged);
  }

  const clientId = randomUUID();

  // 1) 提交
  const submit = await fetch(`${baseUrl}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: workflow, client_id: clientId }),
  });
  if (!submit.ok) {
    const detail = await submit.text().catch(() => '');
    // 尝试从 node_errors 识别缺失节点
    try {
      const j = JSON.parse(detail);
      const missing = findMissingNode(j);
      if (missing) throw new MissingNodeError(missing);
    } catch (e) { if (e instanceof MissingNodeError) throw e; }
    throw new Error(`ComfyUI 提交失败 ${submit.status}: ${detail.slice(0, 300)}`);
  }
  const submitJson = await submit.json();
  const promptId = submitJson?.prompt_id;
  if (!promptId) {
    const missing = findMissingNode(submitJson);
    if (missing) throw new MissingNodeError(missing);
    const nodeErr = submitJson?.node_errors ? JSON.stringify(submitJson.node_errors).slice(0, 300) : '';
    throw new Error(`ComfyUI 未返回 prompt_id ${nodeErr}`);
  }

  // 2) 真实进度(WS) + 轮询兜底
  const wsHandle = openProgressWs(baseUrl, clientId, promptId, onProgress);
  const onAbort = () => { interruptComfy(baseUrl, promptId); };
  signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const deadline = Date.now() + 15 * 60 * 1000; // 单张最多等 15 分钟(低配 M1 首图含模型加载/swap)
    let outputs = null;
    while (Date.now() < deadline) {
      if (signal?.aborted) { await interruptComfy(baseUrl, promptId); throw new Error('已取消'); }
      await sleep(1200);
      onProgress?.(-1); // 心跳(WS 未推进时)
      let hist;
      try {
        const rr = await fetch(`${baseUrl}/history/${promptId}`);
        if (!rr.ok) continue;
        hist = await rr.json();
      } catch {
        continue;
      }
      const entry = hist?.[promptId];
      if (!entry) continue;
      if (entry.status?.status_str === 'error') {
        throw new Error('ComfyUI 执行出错(见 ComfyUI 控制台)');
      }
      if (entry.outputs && Object.keys(entry.outputs).length > 0) {
        outputs = entry.outputs;
        break;
      }
    }
    if (!outputs) throw new Error('ComfyUI 生成超时');

    // 3) 找第一张图并下载
    let img = null;
    for (const nodeId of Object.keys(outputs)) {
      const imgs = outputs[nodeId]?.images;
      if (Array.isArray(imgs) && imgs.length) { img = imgs[0]; break; }
    }
    if (!img) throw new Error('ComfyUI 输出中没有图片');

    const params = new URLSearchParams({
      filename: img.filename,
      subfolder: img.subfolder || '',
      type: img.type || 'output',
    });
    const view = await fetch(`${baseUrl}/view?${params.toString()}`);
    if (!view.ok) throw new Error(`下载 ComfyUI 图片失败 ${view.status}`);
    const buf = Buffer.from(await view.arrayBuffer());
    await fsp.writeFile(outPath, buf);
    onProgress?.(100);
    return outPath;
  } finally {
    wsHandle.close();
    signal?.removeEventListener('abort', onAbort);
  }
}

/** 从 /prompt 的错误响应里找第一个"节点类型不存在"的类名 */
function findMissingNode(j) {
  const ne = j?.node_errors;
  if (ne && typeof ne === 'object') {
    for (const nodeId of Object.keys(ne)) {
      const errs = ne[nodeId]?.errors;
      if (Array.isArray(errs)) {
        for (const e of errs) {
          const t = String(e?.type || '');
          if (t.includes('not_found') || t.includes('invalid') ) {
            return ne[nodeId]?.class_type || nodeId;
          }
        }
      }
    }
  }
  const err = String(j?.error?.message || j?.error || '');
  const m = /node type[^A-Za-z0-9_]*([A-Za-z0-9_]+)/i.exec(err);
  return m ? m[1] : '';
}

/**
 * 读取 ComfyUI 已装模型 / 采样器 / 节点清单(供设置页下拉)。
 * 返回 { checkpoints, vaes, loras, controlnets, upscalers, samplers, schedulers, nodesPresent }。
 */
export async function listModels(url) {
  const baseUrl = trimUrl(url);
  if (!baseUrl) throw new Error('ComfyUI 地址未配置');
  const resp = await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(15000) });
  if (!resp.ok) throw new Error(`读取节点信息失败 ${resp.status}`);
  const info = await resp.json();

  const combo = (node, field) => {
    const arr = info?.[node]?.input?.required?.[field]?.[0];
    return Array.isArray(arr) ? arr : [];
  };
  const ks = info?.KSampler?.input?.required || {};
  return {
    checkpoints: combo('CheckpointLoaderSimple', 'ckpt_name'),
    vaes: combo('VAELoader', 'vae_name'),
    loras: combo('LoraLoader', 'lora_name'),
    controlnets: combo('ControlNetLoader', 'control_net_name'),
    clipVisions: combo('CLIPVisionLoader', 'clip_name'),
    upscalers: combo('UpscaleModelLoader', 'model_name'),
    samplers: Array.isArray(ks.sampler_name?.[0]) ? ks.sampler_name[0] : [],
    schedulers: Array.isArray(ks.scheduler?.[0]) ? ks.scheduler[0] : [],
    nodesPresent: {
      ipadapter: !!info?.IPAdapterUnifiedLoader || !!info?.IPAdapter,
      controlnetAux: !!info?.OpenposePreprocessor || !!info?.DWPreprocessor,
      controlnet: !!info?.ControlNetLoader,
      upscaleModel: !!info?.UpscaleModelLoader,
    },
  };
}

/** 探测 ComfyUI 是否可达 */
export async function ping(url) {
  const baseUrl = trimUrl(url);
  if (!baseUrl) return { ok: false, error: '地址为空' };
  try {
    const r = await fetch(`${baseUrl}/system_stats`, { signal: AbortSignal.timeout(4000) });
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

export default { generateImage, uploadImage, listModels, ping, MissingNodeError };
