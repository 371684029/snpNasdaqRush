// 指数快照 CRUD
import Database from 'better-sqlite3';
import type { IndexPriceRecord } from '../types/market.js';

export class IndexPricesRepo {
  constructor(private db: Database.Database) {}

  upsert(record: Omit<IndexPriceRecord, 'createdAt'>): void {
    this.db.prepare(`
      INSERT INTO index_prices (date, spx_close, spx_high, spx_low, spx_pe,
        ixic_close, ixic_high, ixic_low, spy_nav, spy_change,
        qqq_nav, qqq_change, vix, dollar_index, us10y_yield, us2y_yield, tips_yield)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        spx_close = excluded.spx_close, spx_high = excluded.spx_high,
        spx_low = excluded.spx_low, spx_pe = excluded.spx_pe,
        ixic_close = excluded.ixic_close, ixic_high = excluded.ixic_high,
        ixic_low = excluded.ixic_low,
        spy_nav = excluded.spy_nav, spy_change = excluded.spy_change,
        qqq_nav = excluded.qqq_nav, qqq_change = excluded.qqq_change,
        vix = excluded.vix, dollar_index = excluded.dollar_index,
        us10y_yield = excluded.us10y_yield, us2y_yield = excluded.us2y_yield,
        tips_yield = excluded.tips_yield
    `).run(
      record.date, record.spxClose, record.spxHigh, record.spxLow, record.spxPe,
      record.ixicClose, record.ixicHigh, record.ixicLow,
      record.spyNav, record.spyChange, record.qqqNav, record.qqqChange,
      record.vix, record.dollarIndex, record.us10yYield, record.us2yYield, record.tipsYield
    );
  }

  getByDate(date: string): IndexPriceRecord | undefined {
    const row = this.db.prepare(`SELECT * FROM index_prices WHERE date = ?`).get(date) as Record<string, unknown> | undefined;
    return row ? mapRow(row) : undefined;
  }

  getRecent(days: number): IndexPriceRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM index_prices
      WHERE date >= date('now', '-' || ? || ' days')
      ORDER BY date ASC
    `).all(days) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  getRange(from: string, to: string): IndexPriceRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM index_prices
      WHERE date >= ? AND date <= ?
      ORDER BY date ASC
    `).all(from, to) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  getAfter(date: string, limit: number = 30): IndexPriceRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM index_prices
      WHERE date > ?
      ORDER BY date ASC
      LIMIT ?
    `).all(date, limit) as Record<string, unknown>[];
    return rows.map(mapRow);
  }

  count(): number {
    const row = this.db.prepare(`SELECT COUNT(*) as cnt FROM index_prices`).get() as { cnt: number };
    return row.cnt;
  }
}

function mapRow(row: Record<string, unknown>): IndexPriceRecord {
  return {
    date: row.date as string,
    spxClose: row.spx_close as number | null,
    spxHigh: row.spx_high as number | null,
    spxLow: row.spx_low as number | null,
    spxPe: row.spx_pe as number | null,
    ixicClose: row.ixic_close as number | null,
    ixicHigh: row.ixic_high as number | null,
    ixicLow: row.ixic_low as number | null,
    spyNav: row.spy_nav as number | null,
    spyChange: row.spy_change as number | null,
    qqqNav: row.qqq_nav as number | null,
    qqqChange: row.qqq_change as number | null,
    vix: row.vix as number | null,
    dollarIndex: row.dollar_index as number | null,
    us10yYield: row.us10y_yield as number | null,
    us2yYield: row.us2y_yield as number | null,
    tipsYield: row.tips_yield as number | null,
    createdAt: row.created_at as string,
  };
}
