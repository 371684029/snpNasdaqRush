// 来源分级 + 交叉验证工具 — 对齐 goldRush source-rank.ts

import type { SourceGrade, ValidationResult, ValidationSource, ValidationConsensus, SourcedPrice } from '../types/market.js';

/** 已知来源分级映射 */
const SOURCE_GRADES: Record<string, SourceGrade> = {
  // A级（权威 — 交易所/监管机构）
  'S&P': 'A', 'NASDAQ': 'A', 'NYSE': 'A', 'CME': 'A', 'CBOE': 'A',
  'Federal Reserve': 'A', '美联储': 'A', 'BLS': 'A', 'BEA': 'A',
  'SEC': 'A', 'FRED': 'A', 'FOMC': 'A', 'BIS': 'A',
  // B级（可信 — 财经数据/媒体）
  'Bloomberg': 'B', 'Reuters': 'B', '路透': 'B', 'FactSet': 'B',
  'CNBC': 'B', 'WSJ': 'B', 'Financial Times': 'B',
  'Yahoo Finance': 'B', 'MarketWatch': 'B', 'Barron\'s': 'B',
  'Morningstar': 'B', 'Zacks': 'B', 'Seeking Alpha': 'B',
  'Investing.com': 'B', 'TradingView': 'B',
  '东方财富': 'B', '雪球': 'B', '华尔街见闻': 'B',
  // C级（参考 — 自媒体/论坛）
  '微博': 'C', '知乎': 'C', '贴吧': 'C', '头条': 'C', '微信公众号': 'C',
  'Reddit': 'C', 'Twitter': 'C',
};

/** 判断来源可信度等级 */
export function gradeSource(sourceName: string): SourceGrade {
  if (SOURCE_GRADES[sourceName]) return SOURCE_GRADES[sourceName];
  for (const [key, grade] of Object.entries(SOURCE_GRADES)) {
    if (sourceName.includes(key) || key.includes(sourceName)) return grade;
  }
  return 'B'; // 未知来源默认 B 级
}

/** 交叉验证多个来源的数据 */
export function crossValidate(
  field: string,
  sources: ValidationSource[],
  tolerancePct: number = 1,
): ValidationResult {
  if (sources.length === 0) {
    return { field, sources, consensus: 'major_conflict', finalValue: 0, confidence: 0 };
  }
  if (sources.length === 1) {
    const grade = sources[0].grade;
    const confidence = grade === 'A' ? 55 : grade === 'B' ? 45 : 35;
    return { field, sources, consensus: 'single_source', finalValue: sources[0].value, confidence };
  }

  const numericValues = sources.filter(s => typeof s.value === 'number').map(s => s.value as number);
  if (numericValues.length < 2) {
    return { field, sources, consensus: 'verified', finalValue: sources[0].value, confidence: 60 };
  }

  const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
  const maxDeviation = Math.max(...numericValues.map(v => Math.abs((v - avg) / avg * 100)));

  let consensus: ValidationConsensus;
  let finalValue: number | string;
  let confidence: number;

  if (maxDeviation < 0.5) {
    consensus = 'verified';
    finalValue = avg;
    confidence = 95;
  } else if (maxDeviation < tolerancePct) {
    consensus = 'minor_deviation';
    finalValue = avg;
    confidence = 80;
  } else {
    consensus = 'major_conflict';
    const aGradeSources = sources.filter(s => s.grade === 'A');
    finalValue = aGradeSources.length > 0 ? (aGradeSources[0].value as number) : avg;
    confidence = 50;
  }

  return { field, sources, consensus, finalValue, confidence };
}

/** 判断数据时效性 */
export function checkFreshness(dataTime: string, thresholdHours: number = 4): { fresh: boolean; ageHours: number; warning?: string } {
  const dataDate = new Date(dataTime);
  if (Number.isNaN(dataDate.getTime())) {
    return { fresh: false, ageHours: 0, warning: `⚠️ 数据时间戳无效（${dataTime || '空'}），无法判断时效性` };
  }
  const now = new Date();
  const ageMs = now.getTime() - dataDate.getTime();
  const ageHours = ageMs / (1000 * 60 * 60);
  if (ageHours > thresholdHours) {
    return { fresh: false, ageHours: Math.round(ageHours * 10) / 10, warning: `⚠️ 数据已过 ${Math.round(ageHours)} 小时，可能过时` };
  }
  return { fresh: true, ageHours: Math.round(ageHours * 10) / 10 };
}

/** 主报价 + 备用来源 → 交叉验证输入 */
export function validationSourcesFromPrices(
  primary: SourcedPrice | undefined,
  alts?: SourcedPrice[],
): ValidationSource[] {
  const sources: ValidationSource[] = [];
  const push = (p: SourcedPrice | undefined) => {
    if (p?.value == null || !Number.isFinite(p.value)) return;
    sources.push({
      value: p.value,
      source: p.source ?? 'unknown',
      grade: (p.sourceGrade ?? gradeSource(p.source ?? '')) as SourceGrade,
      timestamp: p.verifiedAt ?? '',
    });
  };
  push(primary);
  for (const alt of alts ?? []) push(alt);
  return sources;
}
