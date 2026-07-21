// 确保本地有足够指数历史 — 分析前自动补齐 SPX / IXIC

import type { IndexPricesRepo } from '../db/index-prices.js';
import type { IndexPriceRecord } from '../types/market.js';
import { fetchYahooSpxHistory, fetchYahooIxicHistory } from '../data/yahoo-index-history.js';
import { addCalendarDays, todayDate } from './time.js';

/** 技术指标生效所需最少「有 spx_close 的交易日」行数 */
export const MIN_TRADING_ROWS_FOR_ANALYSIS = 20;

export interface EnsureHistoryResult {
  filled: number;
  attempted: number;
  tradingRows: number;
  source: 'yahoo' | 'none';
  readyForAnalysis: boolean;
}

/** 过去 days 个日历日（含 asOf）中 spx_close 缺失的日期，升序 */
export function listMissingSpxDates(
  repo: IndexPricesRepo,
  days: number,
  asOf: string = todayDate(),
): string[] {
  const missing: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addCalendarDays(asOf, -i);
    const row = repo.getByDate(d);
    if (!row || row.spxClose == null || row.spxClose <= 0) {
      missing.push(d);
    }
  }
  return missing;
}

/** 过去 days 个日历日中 ixic_close 缺失的日期 */
export function listMissingIxicDates(
  repo: IndexPricesRepo,
  days: number,
  asOf: string = todayDate(),
): string[] {
  const missing: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = addCalendarDays(asOf, -i);
    const row = repo.getByDate(d);
    if (!row || row.ixicClose == null || row.ixicClose <= 0) {
      missing.push(d);
    }
  }
  return missing;
}

/** 统计窗口内有效 spx_close 行数（>0） */
export function countSpxRowsInWindow(
  repo: IndexPricesRepo,
  days: number,
  asOf: string = todayDate(),
): number {
  const from = addCalendarDays(asOf, -(days - 1));
  return repo.getRange(from, asOf).filter(r => r.spxClose != null && r.spxClose > 0).length;
}

function emptyUpsert(date: string): Omit<IndexPriceRecord, 'createdAt'> {
  return {
    date,
    spxClose: null,
    spxHigh: null,
    spxLow: null,
    spxPe: null,
    ixicClose: null,
    ixicHigh: null,
    ixicLow: null,
    spyNav: null,
    spyChange: null,
    qqqNav: null,
    qqqChange: null,
    vix: null,
    dollarIndex: null,
    us10yYield: null,
    us2yYield: null,
    tipsYield: null,
  };
}

/**
 * 用 Yahoo ^GSPC / ^IXIC 日线补齐缺失的 spx_close / ixic_close。
 * upsert 仅把待补字段写成数字，其余传 null（后续可硬化为 COALESCE）。
 */
export async function ensureIndexPriceHistory(
  repo: IndexPricesRepo,
  days = 60,
  asOf: string = todayDate(),
): Promise<EnsureHistoryResult> {
  const missingSpx = listMissingSpxDates(repo, days, asOf);
  const missingIxic = listMissingIxicDates(repo, days, asOf);
  const tradingRowsBefore = countSpxRowsInWindow(repo, days, asOf);
  const attempted = new Set([...missingSpx, ...missingIxic]).size;

  if (
    missingSpx.length === 0
    && missingIxic.length === 0
    && tradingRowsBefore >= MIN_TRADING_ROWS_FOR_ANALYSIS
  ) {
    return {
      filled: 0,
      attempted: 0,
      tradingRows: tradingRowsBefore,
      source: 'none',
      readyForAnalysis: true,
    };
  }

  let filled = 0;
  try {
    const [spxRows, ixicRows] = await Promise.all([
      missingSpx.length > 0 ? fetchYahooSpxHistory(days, asOf) : Promise.resolve([]),
      missingIxic.length > 0 ? fetchYahooIxicHistory(days, asOf) : Promise.resolve([]),
    ]);

    const missingSpxSet = new Set(missingSpx);
    const missingIxicSet = new Set(missingIxic);
    const byDate = new Map<string, { spx?: number; ixic?: number; spxHigh?: number | null; spxLow?: number | null; ixicHigh?: number | null; ixicLow?: number | null }>();

    for (const row of spxRows) {
      if (!missingSpxSet.has(row.date)) continue;
      const existing = repo.getByDate(row.date);
      if (existing?.spxClose != null && existing.spxClose > 0) continue;
      const slot = byDate.get(row.date) ?? {};
      slot.spx = row.close;
      slot.spxHigh = row.high ?? row.close;
      slot.spxLow = row.low ?? row.close;
      byDate.set(row.date, slot);
    }

    for (const row of ixicRows) {
      if (!missingIxicSet.has(row.date)) continue;
      const existing = repo.getByDate(row.date);
      if (existing?.ixicClose != null && existing.ixicClose > 0) continue;
      const slot = byDate.get(row.date) ?? {};
      slot.ixic = row.close;
      slot.ixicHigh = row.high ?? row.close;
      slot.ixicLow = row.low ?? row.close;
      byDate.set(row.date, slot);
    }

    for (const [date, slot] of byDate) {
      const payload = emptyUpsert(date);
      if (slot.spx != null) {
        payload.spxClose = slot.spx;
        payload.spxHigh = slot.spxHigh ?? slot.spx;
        payload.spxLow = slot.spxLow ?? slot.spx;
      }
      if (slot.ixic != null) {
        payload.ixicClose = slot.ixic;
        payload.ixicHigh = slot.ixicHigh ?? slot.ixic;
        payload.ixicLow = slot.ixicLow ?? slot.ixic;
      }
      repo.upsert(payload);
      filled++;
    }
  } catch (err) {
    const tradingRows = countSpxRowsInWindow(repo, days, asOf);
    if (tradingRows >= MIN_TRADING_ROWS_FOR_ANALYSIS) {
      return {
        filled: 0,
        attempted,
        tradingRows,
        source: 'none',
        readyForAnalysis: true,
      };
    }
    throw err;
  }

  const tradingRows = countSpxRowsInWindow(repo, days, asOf);
  return {
    filled,
    attempted,
    tradingRows,
    source: 'yahoo',
    readyForAnalysis: tradingRows >= MIN_TRADING_ROWS_FOR_ANALYSIS,
  };
}
