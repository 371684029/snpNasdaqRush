// 指数收盘价序列工具

import type { IndexPriceRecord } from '../types/market.js';
import { deviationFromMA } from '../indicators/index.js';

/** SPX 收盘价 forward-fill，保持与 records 时间序一致 */
export function forwardFillSpxCloses(records: IndexPriceRecord[]): number[] {
  const closes: number[] = [];
  let last: number | null = null;
  for (const r of records) {
    if (r.spxClose != null) last = r.spxClose;
    if (last != null) closes.push(last);
  }
  return closes;
}

/** IXIC 收盘价 forward-fill，保持与 records 时间序一致 */
export function forwardFillIxicCloses(records: IndexPriceRecord[]): number[] {
  const closes: number[] = [];
  let last: number | null = null;
  for (const r of records) {
    if (r.ixicClose != null) last = r.ixicClose;
    if (last != null) closes.push(last);
  }
  return closes;
}

/** 最新收盘价相对 MA 的偏离度（%） */
export function latestDeviationFromMA(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const dev = deviationFromMA(closes, period);
  const last = dev.filter((v): v is number => v !== null).pop();
  return last ?? null;
}