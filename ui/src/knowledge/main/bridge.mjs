/**
 * 知识库模块 - IPC 桥接
 * 遍历目录 -> 调用 MinerU 解析服务 -> 结构化产物落 ~/.moss/knowledge -> 写库 -> 推进度。
 * MinerU server 由用户单独启动,本模块只作为 HTTP 客户端连接它。
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MOSS_HOME = process.env.MOSS_HOME || path.join(os.homedir(), '.moss');
const KNOWLEDGE_DIR = path.join(MOSS_HOME, 'knowledge');
const SETTINGS_PATH = path.join(MOSS_HOME, 'settings.json');
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8000';

// MinerU 原生支持的格式(office 类需服务端装 libreoffice)
const SUPPORTED_EXT = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.doc', '.docx', '.ppt', '.pptx']);

// 单次扫描的运行状态(同一时刻只允许一个扫描任务)
const scanState = { running: false, stop: false };

/**
 * 初始化知识库数据库表
 */
export function initKnowledgeDatabase(db) {
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  if (!fs.existsSync(schemaPath)) return;
  // schema.sql 全部为幂等语句(CREATE ... IF NOT EXISTS / INSERT OR IGNORE),整体执行即可
  try {
    db.exec(fs.readFileSync(schemaPath, 'utf-8'));
  } catch (err) {
    console.error('[Knowledge] Schema error:', err.message);
  }
}

// 从 settings.json 读 MinerU 服务地址,回退到默认
function resolveServerUrl(override) {
  if (override && override.trim()) return override.trim().replace(/\/+$/, '');
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
    const url = raw?.mineru?.serverUrl;
    if (url && String(url).trim()) return String(url).trim().replace(/\/+$/, '');
  } catch {}
  return DEFAULT_SERVER_URL;
}

// 递归收集目录下受支持的文档
async function collectFiles(dir, recursive) {
  const out = [];
  async function walk(current) {
    let entries;
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(current, e.name);
      if (e.isDirectory()) {
        if (recursive && !e.name.startsWith('.')) await walk(full);
      } else if (e.isFile() && SUPPORTED_EXT.has(path.extname(e.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  await walk(dir);
  out.sort();
  return out;
}

// MinerU /file_parse 支持的 backend(本地推理三种)
const SUPPORTED_BACKENDS = new Set(['pipeline', 'vlm-engine', 'hybrid-engine']);

// 调 MinerU /file_parse(JSON 响应),返回 { md, blocks, images }
async function parseWithMineru(serverUrl, filePath, lang, backend) {
  const buf = await fsp.readFile(filePath);
  const form = new FormData();
  form.append('files', new Blob([buf]), path.basename(filePath));
  form.append('backend', SUPPORTED_BACKENDS.has(backend) ? backend : 'pipeline');
  // lang_list 仅对 pipeline 生效,其它 backend 传了也被忽略
  form.append('lang_list', lang || 'ch');
  form.append('return_md', 'true');
  form.append('return_content_list', 'true');
  form.append('return_images', 'true');
  form.append('response_format_zip', 'false');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20 * 60 * 1000); // 单文件上限 20 分钟
  let resp;
  try {
    resp = await fetch(`${serverUrl}/file_parse`, { method: 'POST', body: form, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  const json = await resp.json();
  if (json.error) throw new Error(String(json.error));

  const results = json.results || {};
  const first = Object.values(results)[0];
  if (!first) throw new Error('MinerU 返回空结果');

  const md = first.md_content || '';
  let blocks = [];
  try {
    blocks = JSON.parse(first.content_list || '[]');
  } catch {}
  if (!Array.isArray(blocks)) blocks = [];
  const pageCount = blocks.reduce((m, b) => Math.max(m, (Number(b.page_idx) || 0) + 1), 0);
  return { md, blocks, images: first.images || {}, pageCount };
}

// 把解析产物写到 ~/.moss/knowledge/<docId>/
async function writeArtifacts(docId, md, blocks, images) {
  const outDir = path.join(KNOWLEDGE_DIR, String(docId));
  await fsp.mkdir(outDir, { recursive: true });
  await fsp.writeFile(path.join(outDir, 'doc.md'), md, 'utf-8');
  await fsp.writeFile(path.join(outDir, 'content_list.json'), JSON.stringify(blocks, null, 2), 'utf-8');
  const imgNames = Object.keys(images);
  if (imgNames.length) {
    const imgDir = path.join(outDir, 'images');
    await fsp.mkdir(imgDir, { recursive: true });
    for (const name of imgNames) {
      const dataUrl = images[name];
      const comma = typeof dataUrl === 'string' ? dataUrl.indexOf(',') : -1;
      if (comma < 0) continue;
      await fsp.writeFile(path.join(imgDir, name), Buffer.from(dataUrl.slice(comma + 1), 'base64'));
    }
  }
  return outDir;
}

/**
 * 注册所有 IPC handlers
 */
export function registerKnowledgeIpcHandlers(ipcMain, db) {
  console.log('[Knowledge] Registering IPC handlers...');

  const sendProgress = (data) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) win.webContents.send('knowledge:scanProgress', data);
  };

  // 探活 MinerU 服务
  ipcMain.handle('knowledge:testConnection', async (event, { serverUrl } = {}) => {
    const url = resolveServerUrl(serverUrl);
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(`${url}/docs`, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.name === 'AbortError' ? '连接超时' : err.message };
    }
  });

  // 列出已解析文档
  ipcMain.handle('knowledge:getDocuments', async () => {
    return db.prepare('SELECT * FROM kb_documents ORDER BY updated_at DESC, id DESC').all();
  });

  // 读取某文档解析出的 Markdown
  ipcMain.handle('knowledge:getDocumentMarkdown', async (event, { id }) => {
    const row = db.prepare('SELECT output_dir FROM kb_documents WHERE id = ?').get(id);
    if (!row || !row.output_dir) return { error: '未找到解析结果' };
    try {
      const md = await fsp.readFile(path.join(row.output_dir, 'doc.md'), 'utf-8');
      return { markdown: md };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 停止当前扫描
  ipcMain.handle('knowledge:stopScan', async () => {
    if (scanState.running) scanState.stop = true;
    return { success: true };
  });

  // 开始扫描解析:遍历目录 -> 逐个解析 -> 写库 -> 推进度
  ipcMain.handle('knowledge:startScan', async (event, { dir, lang, recursive, serverUrl, backend } = {}) => {
    if (scanState.running) return { started: false, error: '已有扫描任务在运行' };
    if (!dir || !fs.existsSync(dir)) return { started: false, error: '目录不存在' };

    const url = resolveServerUrl(serverUrl);
    // 先探活,连不上就别开始
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const resp = await fetch(`${url}/docs`, { signal: controller.signal }).finally(() => clearTimeout(timer));
      if (!resp.ok) return { started: false, error: `MinerU 服务不可用 (HTTP ${resp.status})` };
    } catch (err) {
      return { started: false, error: `连不上 MinerU 服务 ${url}:${err.message}` };
    }

    const files = await collectFiles(dir, recursive !== false);
    if (files.length === 0) return { started: false, error: '目录下没有找到支持的文档' };

    scanState.running = true;
    scanState.stop = false;

    // 后台异步处理,立即返回
    (async () => {
      const total = files.length;
      let processed = 0;
      let skipped = 0;
      let failed = 0;
      for (const filePath of files) {
        if (scanState.stop) break;
        const fileName = path.basename(filePath);
        sendProgress({ total, processed, skipped, failed, currentFile: fileName, status: 'running' });

        let st;
        try {
          st = await fsp.stat(filePath);
        } catch {
          failed += 1;
          processed += 1;
          continue;
        }
        const mtime = Math.round(st.mtimeMs);

        // 去重:同路径 + 同 mtime 且已解析完成 -> 跳过
        const existing = db.prepare('SELECT id, status, source_mtime FROM kb_documents WHERE source_path = ?').get(filePath);
        if (existing && existing.status === 'done' && existing.source_mtime === mtime) {
          skipped += 1;
          processed += 1;
          continue;
        }

        // upsert 为 parsing 状态,拿到 docId
        let docId;
        if (existing) {
          docId = existing.id;
          db.prepare("UPDATE kb_documents SET status='parsing', source_mtime=?, source_size=?, error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(mtime, st.size, docId);
        } else {
          const info = db.prepare("INSERT INTO kb_documents (source_path, file_name, source_mtime, source_size, status) VALUES (?, ?, ?, ?, 'parsing')")
            .run(filePath, fileName, mtime, st.size);
          docId = Number(info.lastInsertRowid);
        }

        try {
          const MAX_PARSE_BYTES = 200 * 1024 * 1024; // 200MB
          if (st.size > MAX_PARSE_BYTES) {
            throw new Error(`文件过大, 跳过解析 (${Math.round(st.size / 1024 / 1024)}MB, 上限 200MB)`);
          }
          const started = Date.now();
          const { md, blocks, images, pageCount } = await parseWithMineru(url, filePath, lang, backend);
          const outDir = await writeArtifacts(docId, md, blocks, images);
          const secs = (Date.now() - started) / 1000;
          db.prepare("UPDATE kb_documents SET status='done', page_count=?, block_count=?, parse_seconds=?, output_dir=?, error=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(pageCount, blocks.length, secs, outDir, docId);
        } catch (err) {
          failed += 1;
          db.prepare("UPDATE kb_documents SET status='error', error=?, updated_at=CURRENT_TIMESTAMP WHERE id=?")
            .run(String(err.message || err), docId);
        }
        processed += 1;
      }

      const status = scanState.stop ? 'cancelled' : 'completed';
      scanState.running = false;
      scanState.stop = false;
      sendProgress({ total, processed, skipped, failed, currentFile: '', status });
    })();

    return { started: true, total: files.length };
  });

  console.log('[Knowledge] IPC handlers registered');
}

export default {
  initKnowledgeDatabase,
  registerKnowledgeIpcHandlers,
};
