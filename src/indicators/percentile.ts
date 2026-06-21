// 历史百分位与估值水位

export function percentile(data: number[], value: number): number {
  if (data.length === 0) return 50;
  const sorted = [...data].sort((a, b) => a - b);
  let count = 0;
  for (const d of sorted) {
    if (d <= value) count++;
  }
  return (count / sorted.length) * 100;
}

export function rollingPercentile(data: number[], lookback: number = 60): number | null {
  if (data.length < 2) return null;
  const recent = data.slice(-lookback);
  const current = recent[recent.length - 1];
  return percentile(recent, current);
}

export function valuationLevel(percentile: number): 'low' | 'fair' | 'high' {
  if (percentile <= 20) return 'low';
  if (percentile >= 80) return 'high';
  return 'fair';
}

export function deviationFromMA(data: number[], period: number = 20): (number | null)[] {
  if (data.length < period) return data.map(() => null);
  const result: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const slice = data.slice(i - period + 1, i + 1);
      const mean = slice.reduce((a, b) => a + b, 0) / period;
      result.push(((data[i] - mean) / mean) * 100);
    }
  }

  return result;
}
