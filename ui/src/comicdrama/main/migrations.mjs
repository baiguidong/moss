/**
 * 漫剧模块数据库迁移器
 * 用 PRAGMA user_version 步进, 每步一个事务; 失败回滚并抛出。
 * baseline(schema.sql)在迁移前先以 CREATE TABLE IF NOT EXISTS 幂等建好, 迁移只做增量 ALTER/CREATE。
 */

/** 幂等加列(SQLite 的 ALTER TABLE ADD COLUMN 无 IF NOT EXISTS) */
function addColumn(db, table, col, type) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type}`);
}

// 每个迁移的下标 i 对应目标 user_version = i + 1
const MIGRATIONS = [
  // m1: 索引
  (db) => {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_cd_shots_project ON cd_shots(project_id, idx);
      CREATE INDEX IF NOT EXISTS idx_cd_characters_project ON cd_characters(project_id);
    `);
  },
  // m2: cd_projects 增列(每项目生成配置 / 系列归属)
  (db) => {
    addColumn(db, 'cd_projects', 'gen_config_json', 'TEXT');
    addColumn(db, 'cd_projects', 'series_id', 'INTEGER');
    addColumn(db, 'cd_projects', 'episode_no', 'INTEGER');
  },
  // m3: cd_shots 增列(每镜配方覆盖 / 独立 seed / 参考图 / pose 图)
  (db) => {
    addColumn(db, 'cd_shots', 'recipe_json', 'TEXT');
    addColumn(db, 'cd_shots', 'seed', 'INTEGER');
    addColumn(db, 'cd_shots', 'ref_image_path', 'TEXT');
    addColumn(db, 'cd_shots', 'pose_image_path', 'TEXT');
  },
  // m4: 分镜多版本历史(image_path 仍在 cd_shots 上作为"选中版本"的反范式冗余)
  (db) => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cd_shot_versions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        shot_id INTEGER REFERENCES cd_shots(id),
        image_path TEXT,
        seed INTEGER,
        recipe_json TEXT,
        is_selected INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_cd_shot_versions_shot ON cd_shot_versions(shot_id);
    `);
  },
  // m5: 角色一致性绑定(参考图已在 base schema; 补 LoRA / IPAdapter 权重)
  (db) => {
    addColumn(db, 'cd_characters', 'lora_name', 'TEXT');
    addColumn(db, 'cd_characters', 'lora_strength', 'REAL');
    addColumn(db, 'cd_characters', 'ipadapter_weight', 'REAL');
  },
];

export function runMigrations(db) {
  let version = 0;
  try {
    const row = db.prepare('PRAGMA user_version').get();
    version = row ? Number(row.user_version) || 0 : 0;
  } catch { version = 0; }

  for (let i = version; i < MIGRATIONS.length; i++) {
    try {
      db.exec('BEGIN');
      MIGRATIONS[i](db);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec('COMMIT');
    } catch (err) {
      try { db.exec('ROLLBACK'); } catch { /* ignore */ }
      console.error(`[ComicDrama] migration ${i + 1} failed:`, err.message);
      throw err;
    }
  }
}

export default { runMigrations };
