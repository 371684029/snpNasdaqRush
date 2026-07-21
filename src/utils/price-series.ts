// 指数收盘序列工具 — SPX / IXIC

import type { IndexPriceRecord } from '../types/market.js';
import { deviationFromMA } from '../indicators/index.js';

/** 有效收盘（拒绝 null 与 ≤0，避免 0 污染 MA/RSI） */
function validClose(v: number | null | undefined): v is number {
  return v != null && Number.isFinite(v) && v > 0;
}

/**
 * 收盘价 forward-fill，保持与 records 时间序一致；跳过 0/无效价。
 * @param field 默认 spxClose；可切 ixicClose
 */
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

/** 最新收盘价相对 MA 的偏离度（%） */
export function latestDeviationFromMA(closes: number[], period = 20): number | null {
  if (closes.length < period) return null;
  const dev = deviationFromMA(closes, period);
  const last = dev.filter((v): v is number => v !== null).pop();
  return last ?? null;
}
