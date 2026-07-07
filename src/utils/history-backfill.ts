// 历史指数回填 — 列出缺失日、校验 LLM 提取行

import type { IndexPricesRepo } from '../db/index-prices.js';
import { addCalendarDays, todayDate } from './time.js';

export interface HistoryPriceRow {
  date: string;
  spxClose: number | null;
  ixicClose: number | null;
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
    if (!row || row.spxClose == null) {
      missing.push(d);
    }
  }
  return missing;
}

/** 过滤并规范化 LLM 提取的历史行（仅保留目标日、合法数值） */
export function normalizeHistoryRows(
  rows: HistoryPriceRow[],
  allowedDates: Set<string>,
): HistoryPriceRow[] {
  const out: HistoryPriceRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row?.date || !allowedDates.has(row.date) || seen.has(row.date)) continue;
    if (row.spxClose != null && (!Number.isFinite(row.spxClose) || row.spxClose <= 0)) {
      continue;
    }
    if (row.ixicClose != null && (!Number.isFinite(row.ixicClose) || row.ixicClose <= 0)) {
      continue;
    }
    if (row.spxClose == null && row.ixicClose == null) continue;
    seen.add(row.date);
    out.push({
      date: row.date,
      spxClose: row.spxClose ?? null,
      ixicClose: row.ixicClose ?? null,
    });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
