/**
 * AI 备忘录模块 - IPC 桥接
 * 注册所有备忘录相关的 IPC handlers
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';
import { getMossHome, getVoiceConfig } from './settings.mjs';
import { transcribe } from './stt.mjs';
import { analyzeNote } from './classifier.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * 初始化备忘录数据库表
 */
export function initAiMemoDatabase(db) {
  const schemaPath = path.join(__dirname, '..', 'database', 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    // schema.sql 全部为幂等语句(CREATE ... IF NOT EXISTS / INSERT OR IGNORE),整体执行即可
    try {
      db.exec(fs.readFileSync(schemaPath, 'utf-8'));
    } catch (err) {
      console.error('[AiMemo] Schema error:', err.message);
    }
  }
}

function audioDir() {
  const dir = path.join(getMossHome(), 'aimemo', 'audio');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getCategoriesFromDb(db) {
  return db.prepare('SELECT * FROM memo_categories ORDER BY sort_order, id').all();
}

function upsertTag(db, name) {
  db.prepare('INSERT OR IGNORE INTO memo_tags (name) VALUES (?)').run(name);
  return db.prepare('SELECT id FROM memo_tags WHERE name = ?').get(name)?.id;
}

/**
 * 对一条备忘跑 AI 分析,写回 category/summary/tags/tasks
 */
async function runAnalysis(db, noteId, sendEvent) {
  const note = db.prepare('SELECT * FROM memo_notes WHERE id = ?').get(noteId);
  if (!note) return;
  const text = (note.raw_text || note.transcript || '').trim();
  if (!text) return;

  sendEvent({ noteId, status: 'analyzing' });

  const categories = getCategoriesFromDb(db);
  const result = await analyzeNote(text, categories);

  // 分类
  const matched = categories.find((c) => c.name === result.category);
  const categoryId = matched ? matched.id : null;

  db.prepare(
    'UPDATE memo_notes SET summary = ?, category_id = ?, status = ?, analyzed = 1, updated_at = ? WHERE id = ?'
  ).run(result.summary || '', categoryId, 'classified', new Date().toISOString(), noteId);

  // 标签
  db.prepare('DELETE FROM memo_note_tags WHERE note_id = ?').run(noteId);
  for (const tagName of result.tags) {
    const tagId = upsertTag(db, tagName);
    if (tagId) {
      db.prepare('INSERT OR IGNORE INTO memo_note_tags (note_id, tag_id) VALUES (?, ?)').run(noteId, tagId);
    }
  }

  // 待办 - 先清除上一次自动生成且尚未处理的待办, 避免重复分析时任务翻倍
  db.prepare(
    `DELETE FROM memo_tasks WHERE note_id = ? AND kind = 'reminder' AND status = 'pending'`
  ).run(noteId);
  for (const t of result.tasks) {
    db.prepare(
      `INSERT INTO memo_tasks (note_id, title, detail, due_at, priority, kind, status)
       VALUES (?, ?, ?, ?, ?, 'reminder', 'pending')`
    ).run(noteId, t.title, t.detail || '', t.due_at, t.priority);
  }

  sendEvent({ noteId, status: 'done', taskCount: result.tasks.length });
}

/**
 * 注册所有 IPC handlers
 */
export function registerAiMemoIpcHandlers(ipcMain, db) {
  console.log('[AiMemo] Registering IPC handlers...');

  const sendAnalyzeProgress = (data) => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('aiMemo:analyzeProgress', data);
    }
  };

  // 语音开关:是否配置了语音模型
  ipcMain.handle('aiMemo:voiceEnabled', async () => {
    return { enabled: !!getVoiceConfig() };
  });

  // 语音转写
  ipcMain.handle('aiMemo:transcribe', async (event, { audioBase64, mimeType }) => {
    try {
      if (typeof audioBase64 !== 'string' || audioBase64.length === 0) {
        return { error: '没有音频数据' };
      }
      // base64 长度约为原始字节的 4/3; 上限 ~50MB 解码后, 防止主进程内存暴涨
      const approxBytes = Math.floor(audioBase64.length * 0.75);
      if (approxBytes > 50 * 1024 * 1024) {
        return { error: `音频过大 (约 ${Math.round(approxBytes / 1024 / 1024)}MB, 上限 50MB)` };
      }
      const { text } = await transcribe(audioBase64, mimeType);
      // 保存音频原件
      let audioPath = '';
      try {
        const ext = (mimeType || '').includes('wav') ? 'wav' : 'webm';
        audioPath = path.join(audioDir(), `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`);
        await fsp.writeFile(audioPath, Buffer.from(audioBase64, 'base64'));
      } catch {
        audioPath = '';
      }
      return { text, audioPath };
    } catch (err) {
      return { error: err.message };
    }
  });

  // 创建备忘(随后异步分析)
  ipcMain.handle('aiMemo:createNote', async (event, { source, rawText, audioPath }) => {
    const now = new Date().toISOString();
    const info = db
      .prepare(
        `INSERT INTO memo_notes (source, audio_path, raw_text, transcript, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'inbox', ?, ?)`
      )
      .run(source || 'text', audioPath || '', rawText || '', source === 'voice' ? rawText || '' : '', now, now);

    const noteId = info.lastInsertRowid;
    const note = db.prepare('SELECT * FROM memo_notes WHERE id = ?').get(noteId);

    // 异步分析,不阻塞返回
    runAnalysis(db, Number(noteId), sendAnalyzeProgress).catch((err) => {
      console.error('[AiMemo] analyze failed:', err.message);
      sendAnalyzeProgress({ noteId: Number(noteId), status: 'error', error: err.message });
    });

    return note;
  });

  // 手动重新分析
  ipcMain.handle('aiMemo:analyzeNote', async (event, { noteId }) => {
    try {
      await runAnalysis(db, noteId, sendAnalyzeProgress);
      return { success: true };
    } catch (err) {
      sendAnalyzeProgress({ noteId, status: 'error', error: err.message });
      return { error: err.message };
    }
  });

  // 备忘列表
  ipcMain.handle('aiMemo:getNotes', async (event, { filter } = {}) => {
    let query = 'SELECT * FROM memo_notes WHERE 1=1';
    const params = [];
    if (filter?.categoryId) {
      query += ' AND category_id = ?';
      params.push(filter.categoryId);
    }
    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    query += ' ORDER BY created_at DESC';
    if (filter?.limit) {
      query += ' LIMIT ?';
      params.push(filter.limit);
    }
    const notes = db.prepare(query).all(...params);
    // 附带分类名与标签
    return notes.map((n) => {
      const cat = n.category_id
        ? db.prepare('SELECT name, color, icon FROM memo_categories WHERE id = ?').get(n.category_id)
        : null;
      const tags = db
        .prepare(
          'SELECT t.name FROM memo_tags t JOIN memo_note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?'
        )
        .all(n.id)
        .map((r) => r.name);
      return { ...n, category: cat, tags };
    });
  });

  // 备忘详情
  ipcMain.handle('aiMemo:getNoteDetail', async (event, { noteId }) => {
    const note = db.prepare('SELECT * FROM memo_notes WHERE id = ?').get(noteId);
    if (!note) return { error: 'Note not found' };
    const tags = db
      .prepare('SELECT t.name FROM memo_tags t JOIN memo_note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ?')
      .all(noteId)
      .map((r) => r.name);
    const tasks = db.prepare('SELECT * FROM memo_tasks WHERE note_id = ? ORDER BY id').all(noteId);
    return { ...note, tags, tasks };
  });

  // 删除备忘
  ipcMain.handle('aiMemo:deleteNote', async (event, { noteId }) => {
    db.prepare('DELETE FROM memo_note_tags WHERE note_id = ?').run(noteId);
    db.prepare('DELETE FROM memo_tasks WHERE note_id = ?').run(noteId);
    db.prepare('DELETE FROM memo_notes WHERE id = ?').run(noteId);
    return { success: true };
  });

  // ===== 分类 =====
  ipcMain.handle('aiMemo:getCategories', async () => {
    return getCategoriesFromDb(db);
  });

  ipcMain.handle('aiMemo:addCategory', async (event, { name, aiPrompt, color, icon }) => {
    const max = db.prepare('SELECT MAX(sort_order) as m FROM memo_categories').get()?.m || 0;
    db.prepare(
      'INSERT OR IGNORE INTO memo_categories (name, ai_prompt, color, icon, is_builtin, sort_order) VALUES (?, ?, ?, ?, 0, ?)'
    ).run(name, aiPrompt || '', color || '#94a3b8', icon || 'tag', max + 1);
    return db.prepare('SELECT * FROM memo_categories WHERE name = ?').get(name);
  });

  ipcMain.handle('aiMemo:updateCategory', async (event, { id, name, aiPrompt, color, icon }) => {
    db.prepare('UPDATE memo_categories SET name = ?, ai_prompt = ?, color = ?, icon = ? WHERE id = ?').run(
      name,
      aiPrompt || '',
      color || '#94a3b8',
      icon || 'tag',
      id
    );
    return db.prepare('SELECT * FROM memo_categories WHERE id = ?').get(id);
  });

  ipcMain.handle('aiMemo:deleteCategory', async (event, { id }) => {
    const cat = db.prepare('SELECT is_builtin FROM memo_categories WHERE id = ?').get(id);
    if (cat?.is_builtin) return { error: '内置分类不可删除' };
    db.prepare('UPDATE memo_notes SET category_id = NULL WHERE category_id = ?').run(id);
    db.prepare('DELETE FROM memo_categories WHERE id = ?').run(id);
    return { success: true };
  });

  // ===== 任务/规划 =====
  ipcMain.handle('aiMemo:getTasks', async (event, { filter } = {}) => {
    let query = 'SELECT * FROM memo_tasks WHERE 1=1';
    const params = [];
    if (filter?.status) {
      query += ' AND status = ?';
      params.push(filter.status);
    }
    query += " ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'med' THEN 1 ELSE 2 END, due_at IS NULL, due_at";
    const tasks = db.prepare(query).all(...params);
    return tasks.map((t) => {
      const note = db.prepare('SELECT summary, raw_text FROM memo_notes WHERE id = ?').get(t.note_id);
      return { ...t, noteSummary: note?.summary || note?.raw_text || '' };
    });
  });

  ipcMain.handle('aiMemo:updateTask', async (event, { id, status, reminderAt, agentSessionId, kind }) => {
    const task = db.prepare('SELECT * FROM memo_tasks WHERE id = ?').get(id);
    if (!task) return { error: 'Task not found' };
    db.prepare(
      'UPDATE memo_tasks SET status = ?, reminder_at = ?, agent_session_id = ?, kind = ? WHERE id = ?'
    ).run(
      status ?? task.status,
      reminderAt ?? task.reminder_at,
      agentSessionId ?? task.agent_session_id,
      kind ?? task.kind,
      id
    );
    return db.prepare('SELECT * FROM memo_tasks WHERE id = ?').get(id);
  });

  // 生成交给 agent 执行的 prompt 文本(由渲染层用现有 agent:create-session/agent:send 执行)
  ipcMain.handle('aiMemo:buildTaskPrompt', async (event, { taskId }) => {
    const task = db.prepare('SELECT * FROM memo_tasks WHERE id = ?').get(taskId);
    if (!task) return { error: 'Task not found' };
    const note = db.prepare('SELECT * FROM memo_notes WHERE id = ?').get(task.note_id);
    const parts = [`请帮我完成这个来自备忘录的任务:`, ``, `任务:${task.title}`];
    if (task.detail) parts.push(`细节:${task.detail}`);
    if (task.due_at) parts.push(`截止:${task.due_at}`);
    if (note?.raw_text) parts.push(``, `原始备忘内容:${note.raw_text}`);
    return { prompt: parts.join('\n') };
  });

  console.log('[AiMemo] IPC handlers registered');
}

export default {
  initAiMemoDatabase,
  registerAiMemoIpcHandlers,
};
