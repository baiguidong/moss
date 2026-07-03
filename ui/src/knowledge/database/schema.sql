-- 知识库模块数据库结构
-- 在 moss.db 中创建,表以 kb_ 前缀

-- 已解析文档表
CREATE TABLE IF NOT EXISTS kb_documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_path TEXT UNIQUE NOT NULL,   -- 源文件绝对路径(去重键)
    file_name TEXT NOT NULL,            -- 文件名
    source_mtime INTEGER,               -- 源文件修改时间(ms),配合 source_path 做增量去重
    source_size INTEGER,                -- 源文件字节数
    status TEXT DEFAULT 'pending',      -- pending/parsing/done/error
    page_count INTEGER DEFAULT 0,       -- 解析出的页数
    block_count INTEGER DEFAULT 0,      -- 结构化内容块数
    parse_seconds REAL,                 -- 解析耗时(秒)
    output_dir TEXT,                    -- 解析产物目录(~/.moss/knowledge/<id>)
    error TEXT,                         -- 失败原因
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_kb_documents_status ON kb_documents(status);
