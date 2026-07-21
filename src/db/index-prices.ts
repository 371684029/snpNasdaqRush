// 指数快照 CRUD — 拒零入库 + COALESCE 不覆盖有效值

import Database from 'better-sqlite3';
import type { IndexPriceRecord } from '../types/market.js';

/** 有效市场数值：拒绝 null/NaN/≤0（TIPS 允许负值，单独处理） */
function sanitizePositive(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

function sanitizeTips(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v) || v === 0) return null;
  return v;
}

function sanitizeChange(v: number | null | undefined): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  return v;
}

export class IndexPricesRepo {
  constructor(private db: Database.Database) {}

  /**
   * upsert：无效值（null/0）不覆盖已有有效历史（COALESCE）。
   */
  upsert(record: Omit<IndexPriceRecord, 'createdAt'>): void {
    const spxClose = sanitizePositive(record.spxClose);
    const spxHigh = sanitizePositive(record.spxHigh);
    const spxLow = sanitizePositive(record.spxLow);
    const spxPe = sanitizePositive(record.spxPe);
    const ixicClose = sanitizePositive(record.ixicClose);
    const ixicHigh = sanitizePositive(record.ixicHigh);
    const ixicLow = sanitizePositive(record.ixicLow);
    const spyNav = sanitizePositive(record.spyNav);
    const spyChange = sanitizeChange(record.spyChange);
    const qqqNav = sanitizePositive(record.qqqNav);
    const qqqChange = sanitizeChange(record.qqqChange);
    const vix = sanitizePositive(record.vix);
    const dollarIndex = sanitizePositive(record.dollarIndex);
    const us10yYield = sanitizePositive(record.us10yYield);
    const us2yYield = sanitizePositive(record.us2yYield);
    const tipsYield = sanitizeTips(record.tipsYield);

    this.db.prepare(`
      INSERT INTO index_prices (date, spx_close, spx_high, spx_low, spx_pe,
        ixic_close, ixic_high, ixic_low, spy_nav, spy_change,
        qqq_nav, qqq_change, vix, dollar_index, us10y_yield, us2y_yield, tips_yield)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET
        spx_close = COALESCE(excluded.spx_close, index_prices.spx_close),
        spx_high = COALESCE(excluded.spx_high, index_prices.spx_high),
        spx_low = COALESCE(excluded.spx_low, index_prices.spx_low),
        spx_pe = COALESCE(excluded.spx_pe, index_prices.spx_pe),
        ixic_close = COALESCE(excluded.ixic_close, index_prices.ixic_close),
        ixic_high = COALESCE(excluded.ixic_high, index_prices.ixic_high),
        ixic_low = COALESCE(excluded.ixic_low, index_prices.ixic_low),
        spy_nav = COALESCE(excluded.spy_nav, index_prices.spy_nav),
        spy_change = COALESCE(excluded.spy_change, index_prices.spy_change),
        qqq_nav = COALESCE(excluded.qqq_nav, index_prices.qqq_nav),
        qqq_change = COALESCE(excluded.qqq_change, index_prices.qqq_change),
        vix = COALESCE(excluded.vix, index_prices.vix),
        dollar_index = COALESCE(excluded.dollar_index, index_prices.dollar_index),
        us10y_yield = COALESCE(excluded.us10y_yield, index_prices.us10y_yield),
        us2y_yield = COALESCE(excluded.us2y_yield, index_prices.us2y_yield),
        tips_yield = COALESCE(excluded.tips_yield, index_prices.tips_yield)
    `).run(
      record.date, spxClose, spxHigh, spxLow, spxPe,
      ixicClose, ixicHigh, ixicLow,
      spyNav, spyChange, qqqNav, qqqChange,
      vix, dollarIndex, us10yYield, us2yYield, tipsYield,
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

function mapPositive(v: unknown): number | null {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

function mapTips(v: unknown): number | null {
  if (v == null || typeof v !== 'number' || !Number.isFinite(v) || v === 0) return null;
  return v;
}

function mapRow(row: Record<string, unknown>): IndexPriceRecord {
  return {
    date: row.date as string,
    spxClose: mapPositive(row.spx_close),
    spxHigh: mapPositive(row.spx_high),
    spxLow: mapPositive(row.spx_low),
    spxPe: mapPositive(row.spx_pe),
    ixicClose: mapPositive(row.ixic_close),
    ixicHigh: mapPositive(row.ixic_high),
    ixicLow: mapPositive(row.ixic_low),
    spyNav: mapPositive(row.spy_nav),
    spyChange: typeof row.spy_change === 'number' && Number.isFinite(row.spy_change) ? row.spy_change : null,
    qqqNav: mapPositive(row.qqq_nav),
    qqqChange: typeof row.qqq_change === 'number' && Number.isFinite(row.qqq_change) ? row.qqq_change : null,
    vix: mapPositive(row.vix),
    dollarIndex: mapPositive(row.dollar_index),
    us10yYield: mapPositive(row.us10y_yield),
    us2yYield: mapPositive(row.us2y_yield),
    tipsYield: mapTips(row.tips_yield),
    createdAt: row.created_at as string,
  };
}
