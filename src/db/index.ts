// SQLite 数据库初始化
import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';

let db: Database.Database | null = null;

/** 获取数据库实例（单例） */
export function getDb(dbPath?: string): Database.Database {
  if (db) return db;

  const resolvedPath = dbPath ?? path.resolve(process.cwd(), 'data', 'snprush.db');

  const dir = path.dirname(resolvedPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(resolvedPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  initializeTables(db);
  return db;
}

/** 关闭数据库 */
export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

/** 初始化所有表 */
function initializeTables(db: Database.Database): void {
  const indexPricesDDL = `
    CREATE TABLE IF NOT EXISTS index_prices (
      date          TEXT PRIMARY KEY,
      spx_close     REAL,
      spx_high      REAL,
      spx_low       REAL,
      spx_pe        REAL,
      ixic_close    REAL,
      ixic_high     REAL,
      ixic_low      REAL,
      spy_nav       REAL,
      spy_change    REAL,
      qqq_nav       REAL,
      qqq_change    REAL,
      vix           REAL,
      dollar_index  REAL,
      us10y_yield   REAL,
      us2y_yield    REAL,
      tips_yield    REAL,
      created_at    TEXT DEFAULT (datetime('now'))
    )
  `;

  const etfNavDDL = `
    CREATE TABLE IF NOT EXISTS etf_nav (
      date        TEXT NOT NULL,
      code        TEXT NOT NULL,
      nav         REAL,
      change_pct  REAL,
      volume      REAL,
      premium     REAL,
      created_at  TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (date, code)
    )
  `;

  const analysisReportsDDL = `
    CREATE TABLE IF NOT EXISTS analysis_reports (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT,
      horizon     TEXT,
      report_json TEXT,
      overall_score INTEGER,
      direction   TEXT,
      created_at  TEXT DEFAULT (datetime('now'))
    )
  `;

  const scenarioFeaturesDDL = `
    CREATE TABLE IF NOT EXISTS scenario_features (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT,
      report_id   INTEGER,
      dollar_direction    TEXT,
      dollar_magnitude    REAL,
      tips_direction      TEXT,
      tips_magnitude      REAL,
      vix_level           REAL,
      fed_stance          TEXT,
      momentum_direction  TEXT,
      consecutive_days    INTEGER,
      actual_5d_return     REAL,
      actual_5d_direction  TEXT,
      actual_20d_return   REAL,
      backfill_status     TEXT DEFAULT 'pending',
      created_at  TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (report_id) REFERENCES analysis_reports(id)
    )
  `;

  const searchCacheDDL = `
    CREATE TABLE IF NOT EXISTS search_cache (
      query_hash  TEXT PRIMARY KEY,
      query       TEXT,
      engine      TEXT,
      results     TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      expires_at  TEXT
    )
  `;

  db.exec(indexPricesDDL);
  db.exec(etfNavDDL);
  db.exec(analysisReportsDDL);
  db.exec(scenarioFeaturesDDL);
  db.exec(searchCacheDDL);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_date ON analysis_reports(date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_reports_score ON analysis_reports(overall_score)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_features_date ON scenario_features(date)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_features_backfill ON scenario_features(backfill_status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cache_expires ON search_cache(expires_at)`);
}
