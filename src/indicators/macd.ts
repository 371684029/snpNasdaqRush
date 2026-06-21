// MACD 指标

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

export function macd(data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): MACDResult[] {
  if (data.length < slowPeriod + signalPeriod) return [];

  const fastEMA = computeEMA(data, fastPeriod);
  const slowEMA = computeEMA(data, slowPeriod);

  if (fastEMA.length < slowPeriod || slowEMA.length < slowPeriod) return [];

  // MACD line = fastEMA - slowEMA
  const macdLine: number[] = [];
  const startIdx = data.length - fastEMA.length;
  for (let i = 0; i < fastEMA.length; i++) {
    const slowIdx = i + (fastEMA.length - slowEMA.length);
    if (slowIdx >= 0 && slowIdx < slowEMA.length) {
      macdLine.push(fastEMA[i] - slowEMA[slowIdx]);
    }
  }

  // Signal line = EMA of MACD line
  const signalLine = computeEMA(macdLine, signalPeriod);

  // Build results
  const result: MACDResult[] = [];
  const signalOffset = macdLine.length - signalLine.length;
  for (let i = 0; i < signalLine.length; i++) {
    const macdV = macdLine[i + signalOffset];
    const signalV = signalLine[i];
    result.push({
      macd: macdV,
      signal: signalV,
      histogram: macdV - signalV,
    });
  }

  return result;
}

export function latestMACD(data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): MACDResult | null {
  const values = macd(data, fastPeriod, slowPeriod, signalPeriod);
  return values.length > 0 ? values[values.length - 1] : null;
}

export function macdCross(data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9): 'golden' | 'dead' | null {
  const values = macd(data, fastPeriod, slowPeriod, signalPeriod);
  if (values.length < 2) return null;

  const prev = values[values.length - 2];
  const curr = values[values.length - 1];

  if (prev.histogram <= 0 && curr.histogram > 0) return 'golden';
  if (prev.histogram >= 0 && curr.histogram < 0) return 'dead';
  return null;
}

function computeEMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const multiplier = 2 / (period + 1);
  const result: number[] = [];
  result.push(data.slice(0, period).reduce((a, b) => a + b, 0) / period);
  for (let i = period; i < data.length; i++) {
    result.push((data[i] - result[result.length - 1]) * multiplier + result[result.length - 1]);
  }
  return result;
}
