/**
 * 漫剧模块 - IPC 桥接
 * 注册所有 comicDrama:* handlers, 管理美术/合成 worker 生命周期
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow, dialog, utilityProcess } from 'electron';
import {
  getComfyConfig,
  saveComfyConfig,
  getProjectDir,
  getComicHome,
  getAssetsDir,
  dimsFor,
} from './settings.mjs';
import { generateScript } from './script.mjs';
import { ping as pingComfy, listModels } from './comfy.mjs';
import { runMigrations } from './migrations.mjs';
import { checkSetup } from './setup.mjs';
import { allowMediaRoot } from '../../filemanage/main/media-protocol.mjs';
import { probe } from '../../filemanage/main/ffmpeg.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function initComicDramaDatabase(db) {
  // baseline: schema.sql 全部 CREATE TABLE IF NOT EXISTS, 幂等; 增量交给迁移器
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    try {
      db.exec(fs.readFileSync(schemaPath, 'utf-8'));
    } catch (err) {
      console.error('[ComicDrama] Schema baseline error:', err.message);
    }
  }
  // 增量迁移(PRAGMA user_version 步进, 每步一事务)
  try { runMigrations(db); } catch (err) {
    console.error('[ComicDrama] Migration error:', err.message);
  }
  // 允许通过 moss-media:// 访问模块生成物
  try { allowMediaRoot(getComicHome()); } catch { /* ignore */ }
}

// 定向发送到发起请求的 webContents(回退首个窗口, 兼容无 sender 场景)
function sendTo(sender, channel, data) {
  if (sender && !sender.isDestroyed()) { sender.send(channel, data); return; }
  const win = BrowserWindow.getAllWindows()[0];
  if (win && !win.isDestroyed()) win.webContents.send(channel, data);
}

// 拼装单个分镜的正向提示词: 画风 + 角色外观 + 画面内容
function buildShotPrompt(project, character, shot) {
  return [project?.style_prompt, character?.appearance_prompt, shot?.image_prompt]
    .map((s) => (s || '').trim())
    .filter(Boolean)
    .join(', ');
}

function loadProject(db, projectId) {
  const project = db.prepare('SELECT * FROM cd_projects WHERE id = ?').get(projectId);
  if (!project) return null;
  const characters = db.prepare('SELECT * FROM cd_characters WHERE project_id = ? ORDER BY id').all(projectId);
  const shots = db.prepare('SELECT * FROM cd_shots WHERE project_id = ? ORDER BY idx').all(projectId);
  return { ...project, characters, shots };
}

export function registerComicDramaIpcHandlers(ipcMain, db) {
  console.log('[ComicDrama] Registering IPC handlers...');

  const artJobs = new Map();         // jobKey -> utilityProcess ('art-<pid>' 批量 / 'shot-<id>' 单镜)
  const composeChildren = new Map(); // projectId -> utilityProcess

  // 由角色绑定(参考图/LoRA)推导一致性配方; 供每镜 recipe 作为基底(镜自身 recipe 覆盖)
  function characterRecipe(character) {
    if (!character) return null;
    const out = {};
    if (character.ref_image_path) {
      out.ipadapter = {
        image: character.ref_image_path,
        weight: Number.isFinite(character.ipadapter_weight) ? character.ipadapter_weight : 0.8,
      };
    }
    if (character.lora_name) {
      const s = Number.isFinite(character.lora_strength) ? character.lora_strength : 0.8;
      out.loras = [{ name: character.lora_name, strength_model: s, strength_clip: s }];
    }
    return Object.keys(out).length ? out : null;
  }

  // 组装单镜的 worker 载荷(拼提示词 + 角色 seed + 角色一致性绑定 + 每镜 recipe 覆盖)
  function shotPayload(project, shot) {
    const character = shot.character_id
      ? db.prepare('SELECT * FROM cd_characters WHERE id = ?').get(shot.character_id)
      : null;
    let shotRecipe;
    if (shot.recipe_json) { try { shotRecipe = JSON.parse(shot.recipe_json); } catch { /* ignore */ } }
    // 角色绑定作基底, 镜头自身 recipe 覆盖(镜头显式设置的 ipadapter/loras 优先)
    const charRecipe = characterRecipe(character);
    const recipe = (charRecipe || shotRecipe)
      ? { ...(charRecipe || {}), ...(shotRecipe || {}) }
      : undefined;
    return {
      id: shot.id,
      idx: shot.idx,
      prompt: buildShotPrompt(project, character, shot),
      seed: Number.isFinite(shot.seed) ? shot.seed : (character?.seed ?? Math.floor(Math.random() * 1_000_000_000)),
      recipe,
    };
  }

  // 统一 fork 美术 worker, 逐镜回写 DB 并定向推送进度
  function forkArtJob({ sender, jobKey, projectId, aspect, payloadShots, onAllDone }) {
    const child = utilityProcess.fork(path.join(__dirname, 'art-worker.mjs'), [], { serviceName: 'moss-comic-art' });
    artJobs.set(jobKey, child);
    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      try {
        if (msg.type === 'progress') {
          sendTo(sender, 'comicDrama:artProgress', { projectId, shotId: msg.shotId, idx: msg.idx, total: msg.total, percent: msg.percent });
        } else if (msg.type === 'shotDone') {
          db.prepare('UPDATE cd_shots SET image_path = ?, status = ?, error = NULL WHERE id = ?')
            .run(msg.imagePath, 'done', msg.shotId);
          sendTo(sender, 'comicDrama:shotUpdated', { projectId, shotId: msg.shotId, status: 'done', imagePath: msg.imagePath });
        } else if (msg.type === 'shotError') {
          db.prepare('UPDATE cd_shots SET status = ?, error = ? WHERE id = ?').run('error', msg.error, msg.shotId);
          sendTo(sender, 'comicDrama:shotUpdated', { projectId, shotId: msg.shotId, status: 'error', error: msg.error });
        } else if (msg.type === 'done' || msg.type === 'error') {
          artJobs.delete(jobKey);
          onAllDone?.(msg);
          try { child.kill(); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error('[ComicDrama] art worker message handling failed:', err.message);
      }
    });
    child.on('error', (err) => {
      console.error('[ComicDrama] art worker error:', err?.message || err);
      artJobs.delete(jobKey);
      sendTo(sender, 'comicDrama:shotUpdated', { projectId, status: 'error', error: String(err?.message || err) });
      onAllDone?.({ type: 'error', error: String(err?.message || err) });
    });
    child.on('exit', () => { artJobs.delete(jobKey); });
    child.postMessage({ type: 'start', taskId: jobKey, projectId, aspect, config: getComfyConfig(), shots: payloadShots });
    return child;
  }

  // ===== 配置 =====
  ipcMain.handle('comicDrama:getComfyConfig', async () => getComfyConfig());
  ipcMain.handle('comicDrama:saveComfyConfig', async (e, { patch }) => saveComfyConfig(patch));
  ipcMain.handle('comicDrama:pingComfy', async (e, { url }) => pingComfy(url || getComfyConfig().url));

  // 已装模型/采样器清单(60s 缓存)
  let modelsCache = { at: 0, url: '', data: null };
  ipcMain.handle('comicDrama:listModels', async (e, { url } = {}) => {
    const target = url || getComfyConfig().url;
    const now = Date.now();
    if (modelsCache.data && modelsCache.url === target && now - modelsCache.at < 60_000) {
      return modelsCache.data;
    }
    try {
      const data = await listModels(target);
      modelsCache = { at: now, url: target, data };
      return data;
    } catch (err) {
      return { error: err.message };
    }
  });

  // 本地能力清单(缺失的模型/自定义节点 + 手动下载命令; 绝不自动安装)
  ipcMain.handle('comicDrama:checkSetup', async (e, { url } = {}) => {
    const cfg = getComfyConfig();
    const target = url || cfg.url;
    let models;
    try { models = await listModels(target); } catch (err) { models = { error: err.message }; }
    return checkSetup(models, cfg);
  });

  // 选择参考图/pose 图: 拷入项目 assets 目录, 探测尺寸后返回本地路径
  ipcMain.handle('comicDrama:pickAsset', async (e, { projectId, kind } = {}) => {
    const win = BrowserWindow.getAllWindows()[0];
    let res;
    try {
      res = await dialog.showOpenDialog(win, {
        title: kind === 'pose' ? '选择姿态/骨架图' : '选择参考图',
        properties: ['openFile'],
        filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }],
      });
    } catch (err) {
      return { error: err.message };
    }
    if (res.canceled || !res.filePaths?.length) return { canceled: true };
    const src = res.filePaths[0];
    const ext = path.extname(src).toLowerCase() || '.png';
    const dest = path.join(getAssetsDir(projectId), `${kind || 'ref'}_${Date.now()}${ext}`);
    try { fs.copyFileSync(src, dest); } catch (err) { return { error: err.message }; }
    let width = null; let height = null;
    try { const info = await probe(dest); width = info.width; height = info.height; } catch { /* ignore */ }
    return { path: dest, width, height };
  });

  // ===== 项目 =====
  ipcMain.handle('comicDrama:listProjects', async () => {
    return db.prepare('SELECT * FROM cd_projects ORDER BY updated_at DESC, id DESC').all();
  });

  ipcMain.handle('comicDrama:getProject', async (e, { projectId }) => {
    const p = loadProject(db, projectId);
    return p || { error: '项目不存在' };
  });

  ipcMain.handle('comicDrama:deleteProject', async (e, { projectId }) => {
    db.prepare('DELETE FROM cd_shots WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM cd_characters WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM cd_projects WHERE id = ?').run(projectId);
    try { fs.rmSync(getProjectDir(projectId), { recursive: true, force: true }); } catch { /* ignore */ }
    return { success: true };
  });

  ipcMain.handle('comicDrama:updateProject', async (e, { projectId, fields }) => {
    const allowed = ['title', 'logline', 'synopsis', 'style_prompt', 'aspect_ratio', 'bgm_path', 'gen_config_json'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (fields && k in fields) { sets.push(`${k} = ?`); params.push(fields[k]); }
    }
    if (sets.length) {
      params.push(new Date().toISOString(), projectId);
      db.prepare(`UPDATE cd_projects SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
    }
    return loadProject(db, projectId);
  });

  // ===== 角色增删改 =====
  ipcMain.handle('comicDrama:addCharacter', async (e, { projectId, fields }) => {
    const seed = Number.isFinite(fields?.seed) ? fields.seed : Math.floor(Math.random() * 1_000_000_000);
    db.prepare('INSERT INTO cd_characters (project_id, name, appearance_prompt, seed, ref_image_path) VALUES (?, ?, ?, ?, ?)')
      .run(projectId, fields?.name || '新角色', fields?.appearance_prompt || '', seed, fields?.ref_image_path || null);
    return loadProject(db, projectId);
  });

  ipcMain.handle('comicDrama:updateCharacter', async (e, { characterId, fields }) => {
    const allowed = ['name', 'appearance_prompt', 'seed', 'ref_image_path', 'lora_name', 'lora_strength', 'ipadapter_weight'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (fields && k in fields) { sets.push(`${k} = ?`); params.push(fields[k]); }
    }
    if (sets.length) {
      params.push(characterId);
      db.prepare(`UPDATE cd_characters SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    const c = db.prepare('SELECT * FROM cd_characters WHERE id = ?').get(characterId);
    return c ? loadProject(db, c.project_id) : { error: '角色不存在' };
  });

  ipcMain.handle('comicDrama:deleteCharacter', async (e, { characterId }) => {
    const c = db.prepare('SELECT * FROM cd_characters WHERE id = ?').get(characterId);
    if (!c) return { error: '角色不存在' };
    db.prepare('UPDATE cd_shots SET character_id = NULL WHERE character_id = ?').run(characterId);
    db.prepare('DELETE FROM cd_characters WHERE id = ?').run(characterId);
    return loadProject(db, c.project_id);
  });

  // 把剧本结果的角色/分镜写入某项目(供新建与重生成共用)
  function insertScriptResult(projectId, result) {
    const nameToId = new Map();
    for (const c of result.characters || []) {
      const seed = Math.floor(Math.random() * 1_000_000_000);
      const ci = db
        .prepare('INSERT INTO cd_characters (project_id, name, appearance_prompt, seed) VALUES (?, ?, ?, ?)')
        .run(projectId, c.name, c.appearance || '', seed);
      nameToId.set(c.name, Number(ci.lastInsertRowid));
    }
    for (const s of result.shots || []) {
      const charId = s.character && nameToId.has(s.character) ? nameToId.get(s.character) : null;
      db.prepare(
        `INSERT INTO cd_shots (project_id, idx, scene_desc, image_prompt, subtitle, duration_ms, camera, character_id, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
      ).run(projectId, s.idx, s.scene || '', s.image_prompt || '', s.subtitle || '', s.duration_ms, s.camera, charId);
    }
  }

  // 生成剧本 + 分镜, 落库为一个新项目
  ipcMain.handle('comicDrama:generateScript', async (e, { logline, style, aspect, shotCount }) => {
    try {
      const result = await generateScript({ logline, style, aspect, shotCount });
      const now = new Date().toISOString();
      const info = db
        .prepare(
          `INSERT INTO cd_projects (title, logline, synopsis, style_prompt, aspect_ratio, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'scripted', ?, ?)`
        )
        .run(result.title, logline || '', result.synopsis || '', style || '', aspect || '9:16', now, now);
      const projectId = Number(info.lastInsertRowid);
      insertScriptResult(projectId, result);
      return loadProject(db, projectId);
    } catch (err) {
      return { error: err.message };
    }
  });

  // 重生成剧本: 替换现有项目的角色与分镜(保留项目本身)
  ipcMain.handle('comicDrama:regenerateScript', async (e, { projectId, logline, style, aspect, shotCount }) => {
    const project = db.prepare('SELECT * FROM cd_projects WHERE id = ?').get(projectId);
    if (!project) return { error: '项目不存在' };
    if (artJobs.has(`art-${projectId}`)) return { error: '该项目正在生成美术, 无法重生成剧本' };
    try {
      const result = await generateScript({
        logline: logline ?? project.logline,
        style: style ?? project.style_prompt,
        aspect: aspect ?? project.aspect_ratio,
        shotCount,
      });
      db.exec('BEGIN');
      try {
        db.prepare('DELETE FROM cd_shots WHERE project_id = ?').run(projectId);
        db.prepare('DELETE FROM cd_characters WHERE project_id = ?').run(projectId);
        db.prepare('UPDATE cd_projects SET title = ?, synopsis = ?, status = ?, updated_at = ? WHERE id = ?')
          .run(result.title || project.title, result.synopsis || '', 'scripted', new Date().toISOString(), projectId);
        insertScriptResult(projectId, result);
        db.exec('COMMIT');
      } catch (err) { db.exec('ROLLBACK'); throw err; }
      return loadProject(db, projectId);
    } catch (err) {
      return { error: err.message };
    }
  });

  ipcMain.handle('comicDrama:updateShot', async (e, { shotId, fields }) => {
    const allowed = ['scene_desc', 'image_prompt', 'subtitle', 'duration_ms', 'camera', 'character_id', 'recipe_json', 'seed'];
    const sets = [];
    const params = [];
    for (const k of allowed) {
      if (fields && k in fields) { sets.push(`${k} = ?`); params.push(fields[k]); }
    }
    if (sets.length) {
      params.push(shotId);
      db.prepare(`UPDATE cd_shots SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    return db.prepare('SELECT * FROM cd_shots WHERE id = ?').get(shotId);
  });

  // 新增分镜(追加到末尾)
  ipcMain.handle('comicDrama:addShot', async (e, { projectId, fields }) => {
    const row = db.prepare('SELECT COALESCE(MAX(idx), -1) AS m FROM cd_shots WHERE project_id = ?').get(projectId);
    const idx = Number(row?.m ?? -1) + 1;
    db.prepare(
      `INSERT INTO cd_shots (project_id, idx, scene_desc, image_prompt, subtitle, duration_ms, camera, character_id, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`
    ).run(
      projectId, idx,
      fields?.scene_desc || '', fields?.image_prompt || '', fields?.subtitle || '',
      Number.isFinite(fields?.duration_ms) ? fields.duration_ms : 3000,
      fields?.camera || 'in', fields?.character_id ?? null,
    );
    return loadProject(db, projectId);
  });

  // 删除分镜并重排 idx
  ipcMain.handle('comicDrama:deleteShot', async (e, { shotId }) => {
    const shot = db.prepare('SELECT * FROM cd_shots WHERE id = ?').get(shotId);
    if (!shot) return { error: '分镜不存在' };
    const projectId = shot.project_id;
    db.exec('BEGIN');
    try {
      db.prepare('DELETE FROM cd_shots WHERE id = ?').run(shotId);
      const rest = db.prepare('SELECT id FROM cd_shots WHERE project_id = ? ORDER BY idx').all(projectId);
      rest.forEach((r, i) => db.prepare('UPDATE cd_shots SET idx = ? WHERE id = ?').run(i, r.id));
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); return { error: err.message }; }
    return loadProject(db, projectId);
  });

  // 按给定顺序重排分镜 idx
  ipcMain.handle('comicDrama:reorderShots', async (e, { projectId, orderedIds }) => {
    if (!Array.isArray(orderedIds)) return { error: 'orderedIds 无效' };
    db.exec('BEGIN');
    try {
      orderedIds.forEach((id, i) => db.prepare('UPDATE cd_shots SET idx = ? WHERE id = ? AND project_id = ?').run(i, id, projectId));
      db.exec('COMMIT');
    } catch (err) { db.exec('ROLLBACK'); return { error: err.message }; }
    return loadProject(db, projectId);
  });

  // ===== 美术: 批量分镜(worker) =====
  // only: 'failed'(仅失败) | 'pending'(未完成) | number[](指定 shotId) | undefined(全部)
  ipcMain.handle('comicDrama:generateArt', async (e, { projectId, only }) => {
    const jobKey = `art-${projectId}`;
    if (artJobs.has(jobKey)) return { error: '该项目正在生成美术' };
    const project = db.prepare('SELECT * FROM cd_projects WHERE id = ?').get(projectId);
    if (!project) return { error: '项目不存在' };
    let shots = db.prepare('SELECT * FROM cd_shots WHERE project_id = ? ORDER BY idx').all(projectId);
    if (only === 'failed') shots = shots.filter((s) => s.status === 'error');
    else if (only === 'pending') shots = shots.filter((s) => s.status !== 'done');
    else if (Array.isArray(only)) { const set = new Set(only); shots = shots.filter((s) => set.has(s.id)); }
    if (!shots.length) return { error: '没有需要生成的分镜' };

    const payloadShots = shots.map((s) => shotPayload(project, s));

    db.prepare('UPDATE cd_projects SET status = ?, updated_at = ? WHERE id = ?')
      .run('arting', new Date().toISOString(), projectId);

    forkArtJob({
      sender: e.sender,
      jobKey,
      projectId,
      aspect: project.aspect_ratio,
      payloadShots,
      onAllDone: (msg) => {
        db.prepare('UPDATE cd_projects SET updated_at = ? WHERE id = ?').run(new Date().toISOString(), projectId);
        sendTo(e.sender, 'comicDrama:artDone', { projectId, error: msg.type === 'error' ? msg.error : undefined });
      },
    });

    return { started: true, total: payloadShots.length };
  });

  ipcMain.handle('comicDrama:cancelArt', async (e, { projectId }) => {
    const child = artJobs.get(`art-${projectId}`);
    if (child) { try { child.postMessage({ type: 'stop' }); child.kill(); } catch { /* ignore */ } artJobs.delete(`art-${projectId}`); }
    return { success: true };
  });

  // ===== 美术: 单个分镜(worker, 异步不阻塞主进程) =====
  ipcMain.handle('comicDrama:generateShot', async (e, { shotId }) => {
    const shot = db.prepare('SELECT * FROM cd_shots WHERE id = ?').get(shotId);
    if (!shot) return { error: '分镜不存在' };
    const jobKey = `shot-${shotId}`;
    if (artJobs.has(jobKey)) return { error: '该分镜正在生成' };
    const project = db.prepare('SELECT * FROM cd_projects WHERE id = ?').get(shot.project_id);
    if (!project) return { error: '项目不存在' };

    db.prepare('UPDATE cd_shots SET status = ?, error = NULL WHERE id = ?').run('pending', shotId);
    forkArtJob({
      sender: e.sender,
      jobKey,
      projectId: shot.project_id,
      aspect: project.aspect_ratio,
      payloadShots: [shotPayload(project, shot)],
    });
    return { started: true };
  });

  // ===== 合成成片(worker) =====
  // options: { fps, crf, resolution?:{width,height}, bgmVolume, subtitle?:{fontSize,color,boxOpacity,position,margin} }
  ipcMain.handle('comicDrama:compose', async (e, { projectId, options = {} }) => {
    if (composeChildren.has(projectId)) return { error: '该项目正在合成' };
    const project = db.prepare('SELECT * FROM cd_projects WHERE id = ?').get(projectId);
    if (!project) return { error: '项目不存在' };
    const shots = db.prepare('SELECT * FROM cd_shots WHERE project_id = ? ORDER BY idx').all(projectId);
    const ready = shots.filter((s) => s.image_path && fs.existsSync(s.image_path));
    if (!ready.length) return { error: '没有已生成的画面, 请先生成美术' };

    // 分辨率: 显式覆盖优先; 否则按画幅从生成基准放大(短边取 720 以获得更清晰的成片)
    const base = Number(options?.resolution?.short) || 720;
    const dims = options?.resolution?.width && options?.resolution?.height
      ? { width: options.resolution.width, height: options.resolution.height }
      : dimsFor(project.aspect_ratio, base);
    const output = path.join(getProjectDir(projectId), 'output.mp4');

    const child = utilityProcess.fork(path.join(__dirname, 'compose-worker.mjs'), [], { serviceName: 'moss-comic-compose' });
    composeChildren.set(projectId, child);

    child.on('message', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      try {
        if (msg.type === 'progress') {
          sendTo(e.sender, 'comicDrama:composeProgress', { projectId, percent: msg.percent });
        } else if (msg.type === 'done') {
          composeChildren.delete(projectId);
          db.prepare('UPDATE cd_projects SET output_path = ?, status = ?, updated_at = ? WHERE id = ?')
            .run(msg.output, 'composed', new Date().toISOString(), projectId);
          sendTo(e.sender, 'comicDrama:composeDone', { projectId, output: msg.output });
          try { child.kill(); } catch { /* ignore */ }
        } else if (msg.type === 'error') {
          composeChildren.delete(projectId);
          sendTo(e.sender, 'comicDrama:composeError', { projectId, error: msg.error });
          try { child.kill(); } catch { /* ignore */ }
        }
      } catch (err) {
        console.error('[ComicDrama] compose worker message handling failed:', err.message);
      }
    });
    child.on('error', (err) => {
      console.error('[ComicDrama] compose worker error:', err?.message || err);
      composeChildren.delete(projectId);
      sendTo(e.sender, 'comicDrama:composeError', { projectId, error: String(err?.message || err) });
    });
    child.on('exit', () => { composeChildren.delete(projectId); });

    child.postMessage({
      type: 'start',
      taskId: `compose-${projectId}`,
      options: {
        shots: ready.map((s) => ({ image: s.image_path, duration_ms: s.duration_ms, subtitle: s.subtitle, camera: s.camera })),
        audio: project.bgm_path || undefined,
        output,
        width: dims.width,
        height: dims.height,
        fps: Number(options?.fps) || 30,
        crf: Number.isFinite(options?.crf) ? options.crf : 20,
        bgmVolume: Number.isFinite(options?.bgmVolume) ? options.bgmVolume : 1,
        subtitle: options?.subtitle || undefined,
      },
    });

    return { started: true };
  });

  ipcMain.handle('comicDrama:cancelCompose', async (e, { projectId }) => {
    const child = composeChildren.get(projectId);
    if (child) { try { child.postMessage({ type: 'stop' }); child.kill(); } catch { /* ignore */ } composeChildren.delete(projectId); }
    return { success: true };
  });

  // ===== 选择背景音乐 =====
  ipcMain.handle('comicDrama:pickBgm', async (e, { projectId }) => {
    const win = BrowserWindow.getAllWindows()[0];
    let res;
    try {
      res = await dialog.showOpenDialog(win, {
        title: '选择背景音乐',
        properties: ['openFile'],
        filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg'] }],
      });
    } catch (err) {
      return { error: err.message };
    }
    if (res.canceled || !res.filePaths?.length) return { canceled: true };
    const bgmPath = res.filePaths[0];
    if (projectId) {
      db.prepare('UPDATE cd_projects SET bgm_path = ?, updated_at = ? WHERE id = ?')
        .run(bgmPath, new Date().toISOString(), projectId);
    }
    return { path: bgmPath };
  });

  console.log('[ComicDrama] IPC handlers registered');
}

export default { initComicDramaDatabase, registerComicDramaIpcHandlers };
