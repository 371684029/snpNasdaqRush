// 纯量化评分引擎 — deterministic, zero LLM（美股 SPX/IXIC）
//
// 因子：趋势 / RSI / MACD / 布林 / 估值 / 相对强弱 / VIX / DXY / 10Y / 波动率

import { latestRSI } from './rsi.js';
import { latestMACD } from './macd.js';
import { latestBollinger } from './bollinger.js';
import { latestMA } from './ma.js';
import { percentile } from './percentile.js';

// ============================================================
// Types
// ============================================================

export interface QuantFactorDetail {
  name: string;
  rawValue: number;
  normalizedScore: number;
  weight: number;
  contribution: number;
}

export interface QuantScoreParams {
  closes: number[];
  ixicCloses?: number[];
  dxy?: number[];
  us10y?: number[];
  tips?: number[];
  /** 最新 VIX 点位（单值） */
  vix?: number;
}

export interface QuantScoreResult {
  score: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  factors: Record<string, QuantFactorDetail>;
}

// ============================================================
// 权重（总和 ≈ 1.0）
// ============================================================

const DEFAULT_WEIGHTS: Record<string, number> = {
  trend: 0.15,
  rsi: 0.10,
  macd: 0.10,
  bollinger: 0.05,
  valuation: 0.10,
  relativeStrength: 0.10,
  vix: 0.15,
  dxy: 0.08,
  us10y: 0.10,
  volatility: 0.07,
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
function w(key: string): number {
  return DEFAULT_WEIGHTS[key] ?? 0;
}

function periodReturn(closes: number[], period: number): number | null {
  if (closes.length <= period) return null;
  const a = closes[closes.length - 1 - period];
  const b = closes[closes.length - 1];
  if (!a || a <= 0 || !b || !Number.isFinite(b)) return null;
  return ((b - a) / a) * 100;
}

// ============================================================
// 因子
// ============================================================

function trendFactor(closes: number[]): QuantFactorDetail {
  const ma = latestMA(closes, 20);
  const cur = closes[closes.length - 1];
  const dev = ma != null && ma > 0 ? ((cur - ma) / ma) * 100 : 0;
  return {
    name: 'SPX趋势(MA20)',
    rawValue: Math.round(dev * 100) / 100,
    normalizedScore: clamp(50 + dev * 5, 10, 90),
    weight: w('trend'),
    contribution: 0,
  };
}

function rsiFactor(closes: number[]): QuantFactorDetail {
  const raw = latestRSI(closes, 14) ?? 50;
  return {
    name: 'RSI(14)',
    rawValue: Math.round(raw * 100) / 100,
    normalizedScore: Math.round(clamp(raw, 5, 95)),
    weight: w('rsi'),
    contribution: 0,
  };
}

function macdFactor(closes: number[]): QuantFactorDetail {
  const m = latestMACD(closes);
  const raw = m?.histogram ?? 0;
  const cur = closes[closes.length - 1];
  const scaled = cur > 0 ? (raw / cur) * 1000 : 0;
  return {
    name: 'MACD动能',
    rawValue: Math.round(scaled * 100) / 100,
    normalizedScore: clamp(50 + scaled * 5, 10, 90),
    weight: w('macd'),
    contribution: 0,
  };
}

function bollingerFactor(closes: number[]): QuantFactorDetail {
  const bb = latestBollinger(closes, 20, 2);
  const pB = bb?.percentB ?? 0.5;
  return {
    name: '布林带(%B)',
    rawValue: Math.round(pB * 1000) / 1000,
    normalizedScore: clamp((1 - pB) * 100, 10, 90),
    weight: w('bollinger'),
    contribution: 0,
  };
}

/** 高百分位 = 贵 = 低分 */
function valuationFactor(closes: number[]): QuantFactorDetail {
  const cur = closes[closes.length - 1];
  const pct = closes.length >= 20 ? percentile(closes, cur) : 50;
  return {
    name: '估值(百分位)',
    rawValue: Math.round(pct * 10) / 10,
    normalizedScore: clamp(100 - pct, 10, 90),
    weight: w('valuation'),
    contribution: 0,
  };
}

/** IXIC 相对 SPX 20 日收益差 → Nasdaq 相对强 = risk-on */
function relativeStrengthFactor(spx: number[], ixic: number[]): QuantFactorDetail {
  const spxRet = periodReturn(spx, 20);
  const ixicRet = periodReturn(ixic, 20);
  const rel = spxRet != null && ixicRet != null ? ixicRet - spxRet : 0;
  return {
    name: '相对强弱(IXIC/SPX)',
    rawValue: Math.round(rel * 100) / 100,
    normalizedScore: clamp(50 + rel * 4, 10, 90),
    weight: w('relativeStrength'),
    contribution: 0,
  };
}

/** 低 VIX = risk-on 高分；VIX>25 压分 */
function vixFactor(vix: number): QuantFactorDetail {
  let score = 50;
  if (vix < 12) score = 78;
  else if (vix < 15) score = 68;
  else if (vix < 18) score = 58;
  else if (vix < 22) score = 48;
  else if (vix < 25) score = 38;
  else if (vix < 30) score = 28;
  else score = 18;
  return {
    name: 'VIX恐慌',
    rawValue: Math.round(vix * 100) / 100,
    normalizedScore: score,
    weight: w('vix'),
    contribution: 0,
  };
}

/** 强 DXY 略利空风险资产 */
function dxyFactor(dxy: number[]): QuantFactorDetail {
  const ma = latestMA(dxy, 20);
  const cur = dxy[dxy.length - 1];
  const dev = ma != null && ma > 0 ? ((cur - ma) / ma) * 100 : 0;
  return {
    name: '美元指数(DXY)',
    rawValue: Math.round(dev * 100) / 100,
    normalizedScore: clamp(50 - dev * 8, 10, 90),
    weight: w('dxy'),
    contribution: 0,
  };
}

/** 收益率上行 → 压低权益分 */
function us10yFactor(us10y: number[]): QuantFactorDetail {
  const ma = latestMA(us10y, 20);
  const cur = us10y[us10y.length - 1];
  const base = ma ?? cur;
  const dev = base > 0 ? ((cur - base) / base) * 100 : 0;
  return {
    name: '10Y名义收益率',
    rawValue: Math.round(dev * 100) / 100,
    normalizedScore: clamp(50 - dev * 8, 10, 90),
    weight: w('us10y'),
    contribution: 0,
  };
}

function volatilityFactor(closes: number[]): QuantFactorDetail {
  const period = 14;
  if (closes.length < period + 1) {
    return { name: '波动率(ATR)', rawValue: 0, normalizedScore: 50, weight: w('volatility'), contribution: 0 };
  }
  let sumTR = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    sumTR += Math.abs(closes[i] - closes[i - 1]) / closes[i - 1] * 100;
  }
  const atrPct = sumTR / period;
  const normalized = clamp(50 + (0.5 - atrPct) * 20, 30, 70);
  return {
    name: '波动率(ATR)',
    rawValue: Math.round(atrPct * 100) / 100,
    normalizedScore: Math.round(normalized),
    weight: w('volatility'),
    contribution: 0,
  };
}

// ============================================================
// 主函数
// ============================================================

export function computeQuantScore(params: QuantScoreParams): QuantScoreResult {
  const { closes, ixicCloses, dxy, us10y, vix } = params;

  if (closes.length < 20) {
    return minimalResult();
  }

  const factors: QuantScoreResult['factors'] = {};

  factors.trend = trendFactor(closes);
  factors.rsi = rsiFactor(closes);
  factors.macd = macdFactor(closes);
  factors.bollinger = bollingerFactor(closes);
  factors.valuation = valuationFactor(closes);
  factors.volatility = volatilityFactor(closes);

  if (ixicCloses && ixicCloses.length >= 21) {
    factors.relativeStrength = relativeStrengthFactor(closes, ixicCloses);
  }
  if (vix != null && Number.isFinite(vix) && vix > 0) {
    factors.vix = vixFactor(vix);
  }
  if (dxy && dxy.length >= 20) factors.dxy = dxyFactor(dxy);
  if (us10y && us10y.length >= 20) factors.us10y = us10yFactor(us10y);

  // 缺省因子：按中性 50 占位，保持权重和可解释
  for (const key of Object.keys(DEFAULT_WEIGHTS)) {
    if (!factors[key] && w(key) > 0) {
      factors[key] = {
        name: key,
        rawValue: 0,
        normalizedScore: 50,
        weight: w(key),
        contribution: 0,
      };
    }
  }

  let totalScore = 0;
  let weightSum = 0;
  for (const f of Object.values(factors) as QuantFactorDetail[]) {
    f.contribution = Math.round(f.normalizedScore * f.weight * 100) / 100;
    totalScore += f.contribution;
    weightSum += f.weight;
  }

  // 若部分可选因子未提供且未占位，按已有权重重归一
  if (weightSum > 0 && Math.abs(weightSum - 1) > 0.01) {
    totalScore = totalScore / weightSum;
  }

  const finalScore = Math.round(clamp(totalScore, 0, 100));
  return {
    score: finalScore,
    direction: finalScore >= 58 ? 'bullish' : finalScore <= 42 ? 'bearish' : 'neutral',
    factors,
  };
}

function minimalResult(): QuantScoreResult {
  const f: QuantScoreResult['factors'] = {};
  for (const [key, weight] of Object.entries(DEFAULT_WEIGHTS)) {
    f[key] = {
      name: key,
      rawValue: 0,
      normalizedScore: 50,
      weight,
      contribution: 50 * weight,
    };
  }
  let total = 0;
  for (const v of Object.values(f) as QuantFactorDetail[]) total += v.contribution;
  return { score: Math.round(clamp(total, 0, 100)), direction: 'neutral', factors: f };
}

// ============================================================
// 格式化
// ============================================================

export function formatQuantScoreConsole(result: QuantScoreResult, indent = '  '): string {
  const lines: string[] = [];
  const bar = '─'.repeat(52);
  lines.push(`${indent}🔢 量化评分构成（纯本地计算，零 LLM）`);
  lines.push(`${indent}${bar}`);
  for (const f of Object.values(result.factors) as QuantFactorDetail[]) {
    const pct = Math.round(f.weight * 100);
    if (pct === 0) continue;
    lines.push(
      `${indent}  ${f.name.padEnd(18, ' ')} 信号=${String(f.normalizedScore).padStart(3)} × ${String(pct).padStart(2)}%  →  +${f.contribution.toFixed(1)}`,
    );
  }
  lines.push(`${indent}${bar}`);
  const dm: Record<string, string> = { bullish: '📈 偏多', bearish: '📉 偏空', neutral: '➡️ 中性' };
  lines.push(`${indent}  量化综合分`.padEnd(indent.length + 14) + `= ${result.score}  ${dm[result.direction]}`);
  return lines.join('\n');
}

export function formatQuantScoreMarkdown(
  factors: QuantScoreResult['factors'] | undefined,
  score?: number,
): string {
  if (!factors || Object.keys(factors).length === 0) return '';
  const lines = [
    '### 量化因子构成（纯本地 · 美股）',
    '',
    '| 因子 | 信号分 | 权重 | 贡献 |',
    '|------|--------|------|------|',
  ];
  let sumW = 0;
  for (const f of Object.values(factors) as QuantFactorDetail[]) {
    if (f.weight <= 0) continue;
    sumW += f.weight;
    lines.push(
      `| ${f.name} | ${f.normalizedScore} | ${(f.weight * 100).toFixed(0)}% | +${f.contribution.toFixed(1)} |`,
    );
  }
  if (score != null) {
    lines.push(`| **合计** | | ${(sumW * 100).toFixed(0)}% | **${score}** |`);
  }
  lines.push('');
  lines.push('> 估值高百分位压分；VIX 低偏多；强 DXY / 上行 10Y 略利空风险资产。');
  lines.push('');
  return lines.join('\n');
}
