// 来源分级与交叉验证 — 对齐 apple-gold-rush（单源 / 加权置信度）

import type { SourceGrade, ValidationResult, ValidationSource, ValidationConsensus, SourcedPrice } from '../types/market.js';

/** 单源字段置信度：A 级直连不再封顶 55 */
export function singleSourceConfidence(grade: SourceGrade): number {
  if (grade === 'A') return 72;
  if (grade === 'B') return 50;
  return 35;
}

/** 来源分级 */
export function gradeSource(source: string): SourceGrade {
  const upper = source.toUpperCase();

  const aLevel = [
    'S&P', 'NASDAQ', 'NYSE', 'FED', 'BLS', 'BEA', 'SEC', 'CME',
    'CBOE', 'FRED', 'BLOOMBERG', 'REUTERS', 'FACTSET', 'YAHOO',
  ];
  if (aLevel.some(a => upper.includes(a))) return 'A';

  const bLevel = [
    'CNBC', 'WSJ', 'FINANCIAL TIMES', 'YAHOO FINANCE', 'INVESTING',
    'MARKETWATCH', 'BARRONS', 'MORNINGSTAR', 'ZACKS', 'SEEKING ALPHA',
    'EAST MONEY', 'WALL STREET', 'EARNINGS WHISPER',
  ];
  if (bLevel.some(b => upper.includes(b))) return 'B';

  return 'C';
}

/** 交叉验证多个来源的数据 */
export function crossValidate(field: string, sources: ValidationSource[]): ValidationResult {
  if (sources.length === 0) {
    return { field, sources, consensus: 'major_conflict', finalValue: 'N/A', confidence: 0 };
  }

  if (sources.length === 1) {
    const grade = sources[0].grade;
    return {
      field,
      sources,
      consensus: 'single_source',
      finalValue: sources[0].value,
      confidence: singleSourceConfidence(grade),
    };
  }

  const numericValues = sources.filter(s => typeof s.value === 'number').map(s => s.value as number);

  if (numericValues.length === 0) {
    return { field, sources, consensus: 'verified', finalValue: sources[0].value, confidence: 60 };
  }

  const avg = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
  const maxDev = Math.max(...numericValues.map(v => Math.abs(v - avg) / avg));

  let consensus: ValidationConsensus;
  let confidence: number;

  if (maxDev < 0.003) {
    consensus = 'verified';
    confidence = 95;
  } else if (maxDev < 0.01) {
    consensus = 'minor_deviation';
    confidence = 80;
  } else {
    consensus = 'major_conflict';
    confidence = 50;
  }

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

  const dataTime = new Date(timestamp).getTime();
  if (Number.isNaN(dataTime)) {
    return { fresh: false, warning: `⚠️ 数据时间戳无效（${timestamp || '空'}），无法判断时效性` };
  }

  const diffMinutes = (Date.now() - dataTime) / (1000 * 60);

  if (diffMinutes > 1440) {
    return { fresh: false, warning: `⚠️ 数据已过 ${Math.round(diffMinutes / 60)} 小时` };
  }
  if (diffMinutes > 60) {
    return { fresh: false, warning: `⚠️ 数据 ${Math.round(diffMinutes)} 分钟前获取` };
  }

  return { fresh: true };
}

/** 主报价 + 备用来源 → 交叉验证输入（拒绝 0 / N/A） */
export function validationSourcesFromPrices(
  primary: SourcedPrice | undefined,
  alts?: SourcedPrice[],
): ValidationSource[] {
  const sources: ValidationSource[] = [];
  const push = (p: SourcedPrice | undefined) => {
    if (p?.value == null || !Number.isFinite(p.value) || p.value === 0) return;
    if (p.source === 'N/A') return;
    const src = p.source ?? 'unknown';
    sources.push({
      value: p.value,
      source: src,
      grade: (p.sourceGrade ?? gradeSource(src)) as SourceGrade,
      timestamp: p.verifiedAt ?? '',
    });
  };
  push(primary);
  for (const alt of alts ?? []) push(alt);
  return sources;
}

/**
 * 字段置信度加权：SPX 35% + IXIC 25% + 其余平分 40%。
 * 避免次要字段单源把「指数已锚定」的总分拖死。
 */
export function weightedFieldConfidence(validations: ValidationResult[]): number {
  if (validations.length === 0) return 50;

  const spx = validations.find(v => v.field === 'spx.price' || v.field.startsWith('spx'));
  const ixic = validations.find(v => v.field === 'ixic.price' || v.field.startsWith('ixic'));
  const others = validations.filter(v => v !== spx && v !== ixic);

  if (!spx && !ixic) {
    return Math.round(validations.reduce((s, v) => s + v.confidence, 0) / validations.length);
  }

  let score = 0;
  let weight = 0;
  if (spx) { score += spx.confidence * 0.35; weight += 0.35; }
  if (ixic) { score += ixic.confidence * 0.25; weight += 0.25; }
  if (others.length > 0) {
    const othersAvg = others.reduce((s, v) => s + v.confidence, 0) / others.length;
    score += othersAvg * 0.40;
    weight += 0.40;
  }
  return Math.round(score / Math.max(weight, 0.01));
}
