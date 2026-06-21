// 来源分级与交叉验证

import type { SourceGrade, ValidationResult, ValidationSource, ValidationConsensus } from '../types/market.js';

/** 来源分级 */
export function gradeSource(source: string): SourceGrade {
  const upper = source.toUpperCase();

  // A级 — 权威来源
  const aLevel = [
    'S&P', 'NASDAQ', 'NYSE', 'FED', 'BLS', 'BEA', 'SEC', 'CME',
    'CBOE', 'FRED', 'BLOOMBERG', 'REUTERS', 'FACTST',
  ];
  if (aLevel.some(a => upper.includes(a))) return 'A';

  // B级 — 可信财经媒体
  const bLevel = [
    'CNBC', 'WSJ', 'FINANCIAL TIMES', 'YAHOO FINANCE', 'INVESTING',
    'MARKETWATCH', 'BARRONS', 'MORNINGSTAR', 'ZACKS', 'SEEKING ALPHA',
    'EAST MONEY', 'WALL STREET', 'EARNINGS WHISPER',
  ];
  if (bLevel.some(b => upper.includes(b))) return 'B';

  // C级 — 其他
  return 'C';
}

/** 交叉验证多个来源的数据 */
export function crossValidate(field: string, sources: ValidationSource[]): ValidationResult {
  if (sources.length === 0) {
    return { field, sources, consensus: 'major_conflict', finalValue: 'N/A', confidence: 0 };
  }

  const numericValues = sources.filter(s => typeof s.value === 'number').map(s => s.value as number);

  if (numericValues.length === 0) {
    return { field, sources, consensus: 'verified', finalValue: sources[0].value, confidence: 60 };
  }

  // 取均值
  const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

  // 计算偏差
  const maxDev = Math.max(...numericValues.map(v => Math.abs(v - avg) / avg));

  let consensus: ValidationConsensus;
  let confidence: number;

  if (maxDev < 0.003) { // 0.3% 以内
    consensus = 'verified';
    confidence = 95;
  } else if (maxDev < 0.01) { // 1% 以内
    consensus = 'minor_deviation';
    confidence = 80;
  } else {
    consensus = 'major_conflict';
    confidence = 50;
  }

  // 考虑来源等级加权
  const gradeWeights: Record<SourceGrade, number> = { A: 1.0, B: 0.8, C: 0.5 };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const s of sources) {
    const w = gradeWeights[s.grade] ?? 0.5;
    if (typeof s.value === 'number') {
      weightedSum += (s.value as number) * w;
      weightTotal += w;
    }
  }

  const finalValue = weightTotal > 0 ? Math.round((weightedSum / weightTotal) * 100) / 100 : numericValues[0];

  return { field, sources, consensus, finalValue, confidence };
}

/** 检查数据时效性 */
export function checkFreshness(timestamp?: string): { fresh: boolean; warning?: string } {
  if (!timestamp) return { fresh: false, warning: '数据无时间戳' };

  const now = Date.now();
  const dataTime = new Date(timestamp).getTime();

  if (isNaN(dataTime)) return { fresh: false, warning: '时间戳格式无效' };

  const diffMinutes = (now - dataTime) / (1000 * 60);

  if (diffMinutes > 1440) { // > 24小时
    return { fresh: false, warning: `⚠️ 数据已过 ${Math.round(diffMinutes / 60)} 小时` };
  }
  if (diffMinutes > 60) { // > 1小时
    return { fresh: false, warning: `⚠️ 数据 ${Math.round(diffMinutes)} 分钟前获取` };
  }

  return { fresh: true };
}
