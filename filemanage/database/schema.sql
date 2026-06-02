-- 文件管理模块数据库结构
-- 在 moss.db 中创建

-- 原始文件表
CREATE TABLE IF NOT EXISTS fm_original_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    filename TEXT NOT NULL,
    extension TEXT,
    file_type TEXT,           -- image/video/document/audio/other
    mime_type TEXT,
    size INTEGER,
    width INTEGER,            -- 图片/视频宽度
    height INTEGER,           -- 图片/视频高度
    duration INTEGER,         -- 视频/音频时长(秒)
    created_at DATETIME,      -- 文件创建时间
    modified_at DATETIME,     -- 文件修改时间
    scan_date DATETIME,       -- 扫描时间
    exif_date DATETIME,       -- EXIF日期(照片拍摄时间)
    checksum TEXT,            -- MD5校验
    thumbnail_path TEXT,      -- 缩略图路径
    is_encrypted BOOLEAN DEFAULT 0,
    is_duplicate BOOLEAN DEFAULT 0,
    duplicate_of INTEGER REFERENCES fm_original_files(id)
);

-- 整理后的文件表
CREATE TABLE IF NOT EXISTS fm_organized_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_id INTEGER REFERENCES fm_original_files(id),
    organized_path TEXT NOT NULL,
    category TEXT,            -- 分类名称
    subcategory TEXT,         -- 子分类
    tags TEXT,                -- JSON array
    ai_description TEXT,      -- AI生成的描述
    ai_confidence REAL,       -- AI置信度 0-1
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 加密保险箱表
CREATE TABLE IF NOT EXISTS fm_encrypted_vault (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    original_id INTEGER REFERENCES fm_original_files(id),
    encrypted_path TEXT NOT NULL,
    original_filename TEXT,
    file_type TEXT,
    original_size INTEGER,
    encrypted_size INTEGER,
    password_hint TEXT,
    encryption_algo TEXT DEFAULT 'aes-256-gcm',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_accessed DATETIME
);

-- 分类规则表
CREATE TABLE IF NOT EXISTS fm_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    parent_id INTEGER REFERENCES fm_categories(id),
    path_pattern TEXT,        -- 对应的存储路径模式
    ai_prompt TEXT,           -- AI识别提示词
    color TEXT,               -- 显示颜色
    icon TEXT,                -- 图标名称
    sort_order INTEGER DEFAULT 0
);

-- 扫描任务表
CREATE TABLE IF NOT EXISTS fm_scan_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    source_paths TEXT,        -- JSON array
    target_path TEXT,         -- 整理目标路径
    status TEXT,              -- pending/running/completed/cancelled/paused
    progress INTEGER DEFAULT 0,
    total_files INTEGER DEFAULT 0,
    processed_files INTEGER DEFAULT 0,
    error_files INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    started_at DATETIME,
    completed_at DATETIME,
    config TEXT               -- JSON: 扫描配置
);

-- 文件标签表
CREATE TABLE IF NOT EXISTS fm_tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    color TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 文件-标签关联表
CREATE TABLE IF NOT EXISTS fm_file_tags (
    file_id INTEGER REFERENCES fm_original_files(id),
    tag_id INTEGER REFERENCES fm_tags(id),
    PRIMARY KEY (file_id, tag_id)
);

-- 人物表 (后期扩展 - 人脸识别)
CREATE TABLE IF NOT EXISTS fm_persons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    face_embedding TEXT,       -- 人脸特征向量
    photo_count INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 文件-人物关联表 (后期扩展)
CREATE TABLE IF NOT EXISTS fm_file_persons (
    file_id INTEGER REFERENCES fm_original_files(id),
    person_id INTEGER REFERENCES fm_persons(id),
    confidence REAL,
    face_region TEXT,          -- JSON: 人脸位置
    PRIMARY KEY (file_id, person_id)
);

-- 插入默认分类
INSERT OR IGNORE INTO fm_categories (name, path_pattern, icon, sort_order) VALUES
    ('图片', '图片', 'image', 1),
    ('视频', '视频', 'video', 2),
    ('文档', '文档', 'file-text', 3),
    ('音乐', '音乐', 'music', 4),
    ('其他', '其他', 'file', 5);

-- 插入图片子分类
INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT '风景', id, '图片/风景', 'mountain', 1 FROM fm_categories WHERE name = '图片';

INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT '人物', id, '图片/人物', 'users', 2 FROM fm_categories WHERE name = '图片';

INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT '美食', id, '图片/美食', 'utensils', 3 FROM fm_categories WHERE name = '图片';

INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT '旅行', id, '图片/旅行', 'plane', 4 FROM fm_categories WHERE name = '图片';

INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT '宠物', id, '图片/宠物', 'cat', 5 FROM fm_categories WHERE name = '图片';

-- 插入视频子分类
INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT '家庭录像', id, '视频/家庭录像', 'home', 1 FROM fm_categories WHERE name = '视频';

INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT '旅行视频', id, '视频/旅行视频', 'plane', 2 FROM fm_categories WHERE name = '视频';

-- 插入文档子分类
INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT 'PDF', id, '文档/PDF', 'file-text', 1 FROM fm_categories WHERE name = '文档';

INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT 'Word', id, '文档/Word', 'file-text', 2 FROM fm_categories WHERE name = '文档';

INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT 'Excel', id, '文档/Excel', 'table', 3 FROM fm_categories WHERE name = '文档';

INSERT OR IGNORE INTO fm_categories (name, parent_id, path_pattern, icon, sort_order)
SELECT 'PPT', id, '文档/PPT', 'presentation', 4 FROM fm_categories WHERE name = '文档';
