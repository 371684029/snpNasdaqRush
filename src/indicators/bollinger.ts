// 布林带指标

export interface BollingerBands {
  upper: number;
  middle: number;
  lower: number;
  percentB: number;
}

export function bollinger(data: number[], period: number = 20, stdDev: number = 2): BollingerBands[] {
  if (data.length < period) return [];

  const result: BollingerBands[] = [];

  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const std = Math.sqrt(variance);
    const upper = mean + stdDev * std;
    const lower = mean - stdDev * std;
    const currentPrice = data[i];
    const percentB = (currentPrice - lower) / (upper - lower);

    result.push({ upper, middle: mean, lower, percentB });
  }

  return result;
}

export function latestBollinger(data: number[], period: number = 20, stdDev: number = 2): BollingerBands | null {
  const values = bollinger(data, period, stdDev);
  return values.length > 0 ? values[values.length - 1] : null;
}
