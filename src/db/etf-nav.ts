// ETF 净值 CRUD
import Database from 'better-sqlite3';
import type { EtfNavRecord } from '../types/etf.js';

export class EtfNavRepo {
  constructor(private db: Database.Database) {}

  upsert(record: Omit<EtfNavRecord, 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO etf_nav (date, code, nav, change_pct, volume, premium)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(date, code) DO UPDATE SET
        nav = excluded.nav, change_pct = excluded.change_pct,
        volume = excluded.volume, premium = excluded.premium
    `).run(record.date, record.code, record.nav, record.changePct, record.volume, record.premium);
  }

  getByDate(date: string): EtfNavRecord[] {
    const rows = this.db.prepare(`SELECT * FROM etf_nav WHERE date = ?`).all(date) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  getRecent(days: number): EtfNavRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM etf_nav
      WHERE date >= date('now', '-' || ? || ' days')
      ORDER BY date ASC
    `).all(days) as Record<string, unknown>[];
    return rows.map(mapRow);
  }
}

function mapRow(row: Record<string, unknown>): EtfNavRecord {
  return {
    date: row.date as string,
    code: row.code as string,
    nav: row.nav as number,
    changePct: row.change_pct as number,
    volume: row.volume as number | null,
    premium: row.premium as number | null,
    createdAt: row.created_at as string,
  };
}
