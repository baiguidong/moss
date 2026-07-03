-- AI 备忘录模块数据库结构
-- 在 moss.db 中创建

-- 备忘录表
CREATE TABLE IF NOT EXISTS memo_notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT DEFAULT 'text',        -- text / voice
    audio_path TEXT,                   -- 语音原件路径
    raw_text TEXT,                     -- 原始输入(语音转写或手输)
    transcript TEXT,                   -- 语音转写结果(冗余保留)
    summary TEXT,                      -- AI 摘要
    category_id INTEGER REFERENCES memo_categories(id),
    status TEXT DEFAULT 'inbox',       -- inbox / classified / archived
    analyzed BOOLEAN DEFAULT 0,        -- 是否已 AI 分析
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 分类表(预设 + 自定义)
CREATE TABLE IF NOT EXISTS memo_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    ai_prompt TEXT,                    -- AI 归类提示词
    color TEXT,
    icon TEXT,
    is_builtin BOOLEAN DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 标签表
CREATE TABLE IF NOT EXISTS memo_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 备忘-标签关联表
CREATE TABLE IF NOT EXISTS memo_note_tags (
    note_id INTEGER REFERENCES memo_notes(id),
    tag_id INTEGER REFERENCES memo_tags(id),
    PRIMARY KEY (note_id, tag_id)
);

-- 待办/任务表(从备忘里 AI 提取)
CREATE TABLE IF NOT EXISTS memo_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    note_id INTEGER REFERENCES memo_notes(id),
    title TEXT NOT NULL,
    detail TEXT,
    due_at DATETIME,                   -- 截止时间
    reminder_at DATETIME,              -- 提醒时间(仅 UI 展示/排序)
    priority TEXT DEFAULT 'med',       -- low / med / high
    kind TEXT DEFAULT 'reminder',      -- reminder / agent
    status TEXT DEFAULT 'pending',     -- pending / running / done
    agent_session_id TEXT,             -- 交给 agent 执行时的会话 id
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 预设分类种子
INSERT OR IGNORE INTO memo_categories (name, ai_prompt, color, icon, is_builtin, sort_order) VALUES
    ('工作', '与工作、项目、会议、任务、职业相关的内容', '#3b82f6', 'briefcase', 1, 1),
    ('生活', '与日常生活、家庭、购物、健康、出行相关的内容', '#22c55e', 'home', 1, 2),
    ('想法', '灵感、点子、思考、创意、随想类的内容', '#a855f7', 'lightbulb', 1, 3),
    ('待办', '需要去做的具体事项、任务、提醒、计划', '#f59e0b', 'check-square', 1, 4),
    ('学习', '学习笔记、知识点、读书、课程、研究相关的内容', '#06b6d4', 'book-open', 1, 5),
    ('其他', '无法归入以上分类的内容', '#94a3b8', 'inbox', 1, 6);
