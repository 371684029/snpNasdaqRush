// 周线聚合 — 基于 forward-fill 后的日线（双指数）

import type { IndexPriceRecord } from '../types/market.js';
import { todayDate } from './time.js';

/** 对缺失 spxClose 做前向填充（不改变原数组顺序） */
export function forwardFillSpxClose(records: IndexPriceRecord[]): IndexPriceRecord[] {
  let last: number | null = null;
  return records.map(r => {
    if (r.spxClose != null) last = r.spxClose;
    if (last != null && r.spxClose == null) {
      return { ...r, spxClose: last };
    }
    return r;
  });
}

/** 对缺失 ixicClose 做前向填充 */
export function forwardFillIxicClose(records: IndexPriceRecord[]): IndexPriceRecord[] {
  let last: number | null = null;
  return records.map(r => {
    if (r.ixicClose != null) last = r.ixicClose;
    if (last != null && r.ixicClose == null) {
      return { ...r, ixicClose: last };
    }
    return r;
  });
}

/**
 * 将日线聚合为周线收盘（ISO 周一为界）。
 * 每周至少 3 个交易日才计入；收盘取该周最后一个有效 close。
 */
export function aggregateWeeklyCloses(
  records: IndexPriceRecord[],
  field: 'spxClose' | 'ixicClose',
): Array<{ weekStart: string; close: number }> {
  const fillFn = field === 'spxClose' ? forwardFillSpxClose : forwardFillIxicClose;
  const filled = fillFn(records);
  const weekMap = new Map<string, number[]>();

  for (const r of filled) {
    const val = r[field];
    if (val == null) continue;
    const d = new Date(`${r.date}T12:00:00-05:00`); // America/New_York
    const day = d.getDay();
    const monOffset = day === 0 ? -6 : 1 - day;
    const mon = new Date(d);
    mon.setDate(d.getDate() + monOffset);
    const weekKey = todayDate(mon);

    if (!weekMap.has(weekKey)) weekMap.set(weekKey, []);
    weekMap.get(weekKey)!.push(val);
  }

  const result: Array<{ weekStart: string; close: number }> = [];
  for (const [weekStart, closes] of weekMap) {
    if (closes.length < 3) continue;
    result.push({ weekStart, close: closes[closes.length - 1] });
  }
  return result.sort((a, b) => a.weekStart.localeCompare(b.weekStart));
}
