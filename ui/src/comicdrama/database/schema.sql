-- 漫剧模块数据库结构
-- 在 moss.db 中创建, 表前缀 cd_

-- 项目(一集漫剧)
CREATE TABLE IF NOT EXISTS cd_projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,                 -- 标题
    logline TEXT,                        -- 用户输入的一句话梗概/题材
    synopsis TEXT,                       -- AI 生成的剧情简介
    style_prompt TEXT,                   -- 画风前缀(拼进每个分镜的画面提示词)
    aspect_ratio TEXT DEFAULT '9:16',    -- 9:16 竖屏 / 16:9 横屏
    bgm_path TEXT,                       -- 背景音乐本地路径
    output_path TEXT,                    -- 合成成片 mp4 路径
    status TEXT DEFAULT 'draft',         -- draft / scripted / arting / composed
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 角色(用于跨分镜保持一致: 固定 seed + 外观提示词)
CREATE TABLE IF NOT EXISTS cd_characters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES cd_projects(id),
    name TEXT NOT NULL,
    appearance_prompt TEXT,              -- 外观描述(拼进画面提示词)
    seed INTEGER,                        -- 固定随机种子, 稳定角色形象
    ref_image_path TEXT,                 -- 可选参考图(IPAdapter 用)
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 分镜
CREATE TABLE IF NOT EXISTS cd_shots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id INTEGER REFERENCES cd_projects(id),
    idx INTEGER NOT NULL,                -- 顺序(从 0 开始)
    scene_desc TEXT,                     -- 场景/画面描述(人读)
    image_prompt TEXT,                   -- 送给 ComfyUI 的画面提示词
    subtitle TEXT,                       -- 字幕/台词/旁白
    duration_ms INTEGER DEFAULT 3000,    -- 该分镜展示时长(毫秒)
    camera TEXT DEFAULT 'in',            -- 运镜方向 in/out/left/right(Ken Burns)
    character_id INTEGER REFERENCES cd_characters(id), -- 主要出场角色(取其 seed)
    image_path TEXT,                     -- 生成的画面 png 路径
    status TEXT DEFAULT 'pending',       -- pending / done / error
    error TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
