// 长期方向预期 — 1/3/5 年（纯本地规则，基于当日四维度 + 宏观阶段）
// 适配美股双指数（SPX / IXIC）+ ETF 配置场景

import type {
  Direction,
  FundamentalAnalysis,
  LongTermHorizonOutlook,
  LongTermHorizonYears,
  LongTermOutlook,
  RebuttalAnalysis,
  SentimentAnalysis,
  TechnicalAnalysis,
} from '../types/analysis.js';
import type { MacroRegime } from './macro-regime.js';

export interface LongTermOutlookInput {
  technical: TechnicalAnalysis;
  fundamental: FundamentalAnalysis;
  sentiment: SentimentAnalysis;
  rebuttal: RebuttalAnalysis;
  overallScore: number;
  overallDirection: Direction;
  macroRegime: MacroRegime;
}

const HORIZONS: LongTermHorizonYears[] = [1, 3, 5];

/** 各期限维度权重（技术/基本面/情绪/宏观） */
const WEIGHTS: Record<LongTermHorizonYears, [number, number, number, number]> = {
  1: [0.25, 0.35, 0.25, 0.15],
  3: [0.10, 0.35, 0.35, 0.20],
  5: [0.05, 0.30, 0.40, 0.25],
};

function directionBias(score: number, direction: Direction): number {
  const adj = direction === 'bullish' ? 8 : direction === 'bearish' ? -8 : 0;
  return Math.max(0, Math.min(100, score + adj));
}

/** 美股宏观阶段偏多/偏空倾向（0-100，越高越偏多） */
function macroBias(regime: MacroRegime): number {
  const map: Record<string, number> = {
    low_vol_rally: 68,
    rate_cut_cycle: 65,
    earnings_upcycle: 62,
    soft_landing: 58,
    range_bound: 50,
    yield_curve_inverted: 40,
    rate_volatility: 48,
    extended_rally: 45,
    risk_off: 35,
    crisis_mode: 25,
    unknown: 50,
  };
  return map[regime.tag] ?? 50;
}

function rebuttalPenalty(rebuttal: RebuttalAnalysis, years: LongTermHorizonYears): number {
  const bear = rebuttal.bearScore ?? 50;
  const strength = rebuttal.rebuttalStrength === 'strong' ? 1.2 : rebuttal.rebuttalStrength === 'moderate' ? 1 : 0.7;
  const horizonFactor = years === 1 ? 1 : years === 3 ? 0.7 : 0.5;
  return ((bear - 50) / 50) * 12 * strength * horizonFactor;
}

function scoreToDirection(bias: number): Direction {
  if (bias >= 58) return 'bullish';
  if (bias <= 42) return 'bearish';
  return 'neutral';
}

function trendLabel(direction: Direction, bias: number): string {
  if (direction === 'bullish') {
    return bias >= 70 ? '偏强上行' : '温和上行';
  }
  if (direction === 'bearish') {
    return bias <= 30 ? '偏弱下行' : '温和下行';
  }
  return '宽幅震荡';
}

/**
 * 名义累计回报区间（非承诺）。
 * 美股长期年化：标普 ~8-10%，纳斯达克 ~10-12%，此处取偏中性的基准。
 */
function returnBand(direction: Direction, bias: number, years: LongTermHorizonYears): string {
  // 年化基准中枢（%）
  const annualBase = direction === 'bullish'
    ? 8 + (bias - 50) * 0.12
    : direction === 'bearish'
      ? -6 - (50 - bias) * 0.12
      : 2 + (bias - 50) * 0.08;
  // 累计中枢（粗略复利）
  const mid = (Math.pow(1 + annualBase / 100, years) - 1) * 100;
  // 区间宽度（年化波动）
  const annualSpread = direction === 'neutral' ? 6 : 10;
  const spread = (Math.pow(1 + annualSpread / 100, years) - 1) * 100;
  const lo = Math.round((mid - spread) * 10) / 10;
  const hi = Math.round((mid + spread) * 10) / 10;
  const sign = lo >= 0 ? '+' : '';
  return `名义累计约 ${sign}${lo}% ~ ${hi >= 0 ? '+' : ''}${hi}%（${years}年，非承诺）`;
}

function confidence(bias: number, rebuttal: RebuttalAnalysis): 'low' | 'moderate' | 'high' {
  const spread = Math.abs(bias - 50);
  if (rebuttal.rebuttalStrength === 'strong' && rebuttal.bearScore >= 60) return 'low';
  if (spread >= 18) return 'high';
  if (spread >= 10) return 'moderate';
  return 'low';
}

function dcaAdvice(direction: Direction, years: LongTermHorizonYears): string {
  if (years >= 5) {
    if (direction === 'bullish') return '维持 VOO/SPY 核心定投；大跌分批加仓 QQQ 卫星，避免追涨一次性重仓';
    if (direction === 'bearish') return '可维持基础定投但放慢节奏；保留现金应对深度回调，估值低位再恢复加码';
    return '标准定投 VOO + QQQ 卫星；估值偏离 MA 下方时适度加码';
  }
  if (direction === 'bullish') return '维持定投；急跌可小幅加码 SPY/QQQ，高位不追';
  if (direction === 'bearish') return '放慢定投或暂停加码；等待评分/估值回落再恢复';
  return '维持基础定投 VOO/SPY，按日历执行，少做择时';
}

function pickDrivers(input: LongTermOutlookInput, years: LongTermHorizonYears): string[] {
  const drivers: string[] = [];
  if (years <= 3 && input.fundamental.fedPolicy) {
    drivers.push(`美联储政策：${input.fundamental.fedPolicy.slice(0, 40)}`);
  }
  if (input.technical.relativeStrength) {
    drivers.push(`SPX/IXIC 相对强弱：${input.technical.relativeStrength.slice(0, 36)}`);
  }
  if (input.sentiment.vixAnalysis) {
    drivers.push(`VIX：${input.sentiment.vixAnalysis.slice(0, 36)}`);
  }
  if (years >= 3 && input.fundamental.macroIndicators) {
    drivers.push(`宏观指标：${input.fundamental.macroIndicators.slice(0, 36)}`);
  }
  drivers.push(`宏观阶段：${input.macroRegime.label}`);
  if (years === 1 && input.technical.summary) {
    drivers.push(`技术趋势：${input.technical.summary.slice(0, 36)}`);
  }
  return drivers.slice(0, 4);
}

function pickRisks(input: LongTermOutlookInput): string[] {
  const risks: string[] = [];
  for (const p of (input.rebuttal.bearPoints ?? []).slice(0, 2)) {
    risks.push(p.point.slice(0, 48));
  }
  for (const t of (input.rebuttal.tailRisks ?? []).slice(0, 1)) {
    risks.push(`${t.risk}（${t.probability}%）`);
  }
  if (input.macroRegime.tag === 'yield_curve_inverted') {
    risks.push('收益率曲线倒挂常领先经济衰退，指数估值承压');
  }
  if (input.macroRegime.tag === 'crisis_mode') {
    risks.push('危机模式下流动性挤兑可能引发指数快速下行');
  }
  if (risks.length === 0) risks.push('地缘与流动性冲击可能导致短期大幅波动');
  return risks.slice(0, 3);
}

function buildHorizon(input: LongTermOutlookInput, years: LongTermHorizonYears): LongTermHorizonOutlook {
  const [wT, wF, wS, wM] = WEIGHTS[years];
  const tech = directionBias(input.technical.score, input.technical.direction);
  const fund = directionBias(input.fundamental.score, input.fundamental.direction);
  const sent = directionBias(input.sentiment.score, input.sentiment.direction);
  const macro = macroBias(input.macroRegime);
  const overall = directionBias(input.overallScore, input.overallDirection);

  let bias = tech * wT + fund * wF + sent * wS + macro * wM;
  bias = bias * 0.85 + overall * 0.15;
  bias -= rebuttalPenalty(input.rebuttal, years);
  bias = Math.max(5, Math.min(95, Math.round(bias)));

  const direction = scoreToDirection(bias);
  return {
    years,
    label: `${years}年`,
    direction,
    biasScore: bias,
    confidence: confidence(bias, input.rebuttal),
    trendLabel: trendLabel(direction, bias),
    returnBand: returnBand(direction, bias, years),
    drivers: pickDrivers(input, years),
    risks: pickRisks(input),
    dcaAdvice: dcaAdvice(direction, years),
  };
}

/** 构建 1/3/5 年长期方向预期 */
export function buildLongTermOutlook(input: LongTermOutlookInput): LongTermOutlook {
  const horizons = HORIZONS.map(y => buildHorizon(input, y));
  const bullishCount = horizons.filter(h => h.direction === 'bullish').length;
  const bearishCount = horizons.filter(h => h.direction === 'bearish').length;

  let summary: string;
  if (bullishCount >= 2) {
    summary = '中长期结构偏多：盈利周期、货币政策与资金面对美股指数相对友好，短期波动不改长期配置价值。';
  } else if (bearishCount >= 2) {
    summary = '多期限共振偏空：估值高位、利率或衰退风险占主导，定投宜放慢节奏、等待更好风险收益比。';
  } else {
    summary = '期限分化：近端受宏观与技术面扰动，远端仍受盈利增长支撑，宜纪律定投、少追涨杀跌。';
  }

  return {
    summary,
    horizons,
    disclaimer: '以上为研究框架下的方向性预期，非精确预测或投资建议；指数/ETF 波动大，请控制仓位与节奏。',
  };
}

export function formatLongTermOutlookConsole(outlook: LongTermOutlook, indent = '  '): string {
  const lines: string[] = [
    `${indent}🔭 长期方向预期（1 / 3 / 5 年）`,
    `${indent}${outlook.summary}`,
    '',
  ];
  for (const h of outlook.horizons) {
    const dir = h.direction === 'bullish' ? '📈 偏多' : h.direction === 'bearish' ? '📉 偏空' : '➡️ 中性';
    lines.push(`${indent}  ${h.label}  ${dir} · ${h.trendLabel} · 强度 ${h.biasScore}/100 · 置信 ${h.confidence}`);
    lines.push(`${indent}      ${h.returnBand}`);
    lines.push(`${indent}      定投：${h.dcaAdvice}`);
  }
  lines.push(`${indent}  ⚠️ ${outlook.disclaimer}`);
  return lines.join('\n');
}

export function formatLongTermOutlookMarkdown(outlook: LongTermOutlook): string {
  const lines: string[] = [
    '## 🔭 长期方向预期（1 / 3 / 5 年）',
    '',
    outlook.summary,
    '',
    '| 期限 | 方向 | 趋势 | 强度 | 置信度 | 名义回报区间（累计） |',
    '|------|------|------|------|--------|---------------------|',
  ];
  for (const h of outlook.horizons) {
    const dir = h.direction === 'bullish' ? '偏多' : h.direction === 'bearish' ? '偏空' : '中性';
    lines.push(`| ${h.label} | ${dir} | ${h.trendLabel} | ${h.biasScore} | ${h.confidence} | ${h.returnBand.replace(/\|/g, '/')} |`);
  }
  lines.push('');
  for (const h of outlook.horizons) {
    lines.push(`### ${h.label}`);
    lines.push('');
    lines.push(`- **驱动**：${h.drivers.join('；')}`);
    lines.push(`- **风险**：${h.risks.join('；')}`);
    lines.push(`- **定投建议**：${h.dcaAdvice}`);
    lines.push('');
  }
  lines.push(`> ${outlook.disclaimer}`);
  lines.push('');
  return lines.join('\n');
}