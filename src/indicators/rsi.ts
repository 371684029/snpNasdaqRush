// RSI 相对强弱指标

export function rsi(data: number[], period: number = 14): number[] {
  if (data.length < period + 1) return [];

  const result: number[] = [];
  for (let i = period; i < data.length; i++) {
    const slice = data.slice(i - period, i + 1);
    let gains = 0;
    let losses = 0;
    for (let j = 1; j < slice.length; j++) {
      const diff = slice[j] - slice[j - 1];
      if (diff > 0) gains += diff;
      else losses -= diff;
    }
    if (losses === 0) {
      result.push(100);
    } else {
      const rs = gains / losses;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

export function latestRSI(data: number[], period: number = 14): number | null {
  const values = rsi(data, period);
  return values.length > 0 ? values[values.length - 1] : null;
}

export function rsiSignal(value: number): string {
  if (value >= 70) return '⚠️ 超买';
  if (value <= 30) return '💡 超卖';
  if (value >= 60) return '偏强';
  if (value <= 40) return '偏弱';
  return '中性';
}
