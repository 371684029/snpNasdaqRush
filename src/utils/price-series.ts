// 指数收盘价序列工具

import type { IndexPriceRecord } from '../types/market.js';
import { deviationFromMA } from '../indicators/index.js';

function validClose(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

/** 通用收盘价 forward-fill（SPX / IXIC） */
export function forwardFillCloses(
  records: IndexPriceRecord[],
  field: 'spxClose' | 'ixicClose' = 'spxClose',
): number[] {
  const closes: number[] = [];
  let last: number | null = null;
  for (const r of records) {
    const v = r[field];
    if (validClose(v)) last = v;
    if (last != null) closes.push(last);
  }
  return closes;
}

/** SPX 收盘价 forward-fill，保持与 records 时间序一致 */
export function forwardFillSpxCloses(records: IndexPriceRecord[]): number[] {
  return forwardFillCloses(records, 'spxClose');
}

/** IXIC 收盘价 forward-fill，保持与 records 时间序一致 */
export function forwardFillIxicCloses(records: IndexPriceRecord[]): number[] {
  return forwardFillCloses(records, 'ixicClose');
}

/** 最新收盘价相对 MA 的偏离度（%） */
export function latestDeviationFromMA(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const dev = deviationFromMA(closes, period);
  const last = dev.filter((v): v is number => v !== null).pop();
  return last ?? null;
}