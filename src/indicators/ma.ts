// 移动平均线

/** 简单移动平均 */
export function sma(data: number[], period: number): number | null {
  if (data.length < period) return null;
  const slice = data.slice(data.length - period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** 指数移动平均 */
export function ema(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result: number[] = [];
  // 初始 SMA
  result.push(data.slice(0, period).reduce((a, b) => a + b, 0) / period);
  for (let i = period; i < data.length; i++) {
    result.push((data[i] - result[result.length - 1]) * multiplier + result[result.length - 1]);
  }
  return result;
}

/** 获取最新 MA 值 */
export function latestMA(data: number[], period: number): number | null {
  return sma(data, period);
}

/** 均线交叉信号 */
export function maCross(shortData: number[], shortPeriod: number, longData: number[], longPeriod: number): 'golden' | 'dead' | null {
  const shortMA = sma(shortData, shortPeriod);
  const longMA = sma(longData, longPeriod);
  if (shortMA === null || longMA === null) return null;

  // 计算前一期 MA
  const prevShort = sma(shortData.slice(0, -1), shortPeriod);
  const prevLong = sma(longData.slice(0, -1), longPeriod);
  if (prevShort === null || prevLong === null) return null;

  if (prevShort <= prevLong && shortMA > longMA) return 'golden';
  if (prevShort >= prevLong && shortMA < longMA) return 'dead';
  return null;
}
