// 纯量化评分引擎 — deterministic, zero LLM, 100% 可复现（参考姊妹项目 goldRush 改造为美股版）
//
// 因子体系（9 类，全部来自本地 SQLite 序列或确定性计算，与 LLM 打分完全独立）：
//   趋势(MA20) + RSI + MACD + 布林带(%B) + 估值(百分位)
//   + VIX 情绪 + 美元指数(DXY) + 10Y 名义利率 + 收益率曲线(10Y-2Y)
// 与 goldRush 的差异：黄金版重 TIPS/主力，美股版重 VIX/收益率曲线；且本实现按「实际存在的因子」
// 重新归一化权重，缺因子不会把总分拖低（更贴近加权平均语义）。

import { latestRSI } from './rsi.js';
import { latestMACD } from './macd.js';
import { latestBollinger } from './bollinger.js';
import { latestMA } from './ma.js';
import { percentile } from './percentile.js';

export interface QuantFactorDetail {
  name: string;
  rawValue: number;
  normalizedScore: number;
  weight: number;
  contribution: number;
}

export interface QuantScoreParams {
  /** 主指数收盘价序列（升序），通常为 SPX */
  closes: number[];
  vix?: number[];
  dxy?: number[];
  us10y?: number[];
  us2y?: number[];
}

export interface QuantScoreResult {
  score: number;
  direction: 'bullish' | 'bearish' | 'neutral';
  factors: Record<string, QuantFactorDetail>;
}

// 权重（原始，未归一；实际按存在的因子重新归一化）
const DEFAULT_WEIGHTS: Record<string, number> = {
  trend: 0.14,
  rsi: 0.12,
  macd: 0.12,
  bollinger: 0.06,
  valuation: 0.10,
  vix: 0.16,
  dxy: 0.08,
  us10y: 0.12,
  yieldcurve: 0.10,
};

function clamp(v: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, v)); }
function w(key: string): number { return DEFAULT_WEIGHTS[key] ?? 0; }

// ---------- 因子 ----------

function trendFactor(closes: number[]): QuantFactorDetail {
  const ma = latestMA(closes, 20);
  const cur = closes[closes.length - 1];
  const dev = ma != null && ma > 0 ? ((cur - ma) / ma) * 100 : 0;
  return { name: '趋势(MA20)', rawValue: Math.round(dev * 100) / 100, normalizedScore: Math.round(clamp(50 + dev * 5, 10, 90)), weight: w('trend'), contribution: 0 };
}

function rsiFactor(closes: number[]): QuantFactorDetail {
  const raw = latestRSI(closes, 14) ?? 50;
  return { name: 'RSI(14)', rawValue: Math.round(raw * 100) / 100, normalizedScore: Math.round(clamp(raw, 5, 95)), weight: w('rsi'), contribution: 0 };
}

function macdFactor(closes: number[]): QuantFactorDetail {
  const m = latestMACD(closes);
  const raw = m?.histogram ?? 0;
  const cur = closes[closes.length - 1];
  const scaled = cur > 0 ? (raw / cur) * 1000 : 0;
  return { name: 'MACD动能', rawValue: Math.round(scaled * 100) / 100, normalizedScore: Math.round(clamp(50 + scaled * 5, 10, 90)), weight: w('macd'), contribution: 0 };
}

/** 布林带 %B — 美股趋势跟随口径：靠近上轨(动能强)偏多 */
function bollingerFactor(closes: number[]): QuantFactorDetail {
  const bb = latestBollinger(closes, 20, 2);
  const pB = Number.isFinite(bb?.percentB) ? (bb as { percentB: number }).percentB : 0.5;
  return { name: '布林带(%B)', rawValue: Math.round(pB * 1000) / 1000, normalizedScore: Math.round(clamp(pB * 100, 10, 90)), weight: w('bollinger'), contribution: 0 };
}

/** 估值百分位 — 越贵越谨慎 */
function valuationFactor(closes: number[]): QuantFactorDetail {
  const cur = closes[closes.length - 1];
  const pct = closes.length >= 20 ? percentile(closes, cur) : 50;
  return { name: '估值(百分位)', rawValue: Math.round(pct * 10) / 10, normalizedScore: Math.round(clamp(100 - pct, 10, 90)), weight: w('valuation'), contribution: 0 };
}

/** VIX 恐慌指数 — 低波动偏多、高波动偏空 */
function vixFactor(vix: number[]): QuantFactorDetail {
  const cur = vix[vix.length - 1];
  return { name: 'VIX情绪', rawValue: Math.round(cur * 100) / 100, normalizedScore: Math.round(clamp(110 - cur * 3, 10, 90)), weight: w('vix'), contribution: 0 };
}

/** 美元指数 — 强美元对美股(尤其科技/跨国)温和承压 */
function dxyFactor(dxy: number[]): QuantFactorDetail {
  const ma = latestMA(dxy, 20);
  const cur = dxy[dxy.length - 1];
  const dev = ma != null && ma > 0 ? ((cur - ma) / ma) * 100 : 0;
  return { name: '美元指数(DXY)', rawValue: Math.round(dev * 100) / 100, normalizedScore: Math.round(clamp(50 - dev * 8, 10, 90)), weight: w('dxy'), contribution: 0 };
}

/** 10Y 名义利率 — 利率上行压制估值 */
function us10yFactor(us10y: number[]): QuantFactorDetail {
  const ma = latestMA(us10y, 20);
  const cur = us10y[us10y.length - 1];
  const base = ma ?? cur;
  const dev = base > 0 ? ((cur - base) / base) * 100 : 0;
  return { name: '10Y名义利率', rawValue: Math.round(cur * 100) / 100, normalizedScore: Math.round(clamp(50 - dev * 8, 10, 90)), weight: w('us10y'), contribution: 0 };
}

/** 收益率曲线(10Y-2Y) — 倒挂(负)预示衰退风险，偏空 */
function yieldCurveFactor(spread: number): QuantFactorDetail {
  return { name: '收益率曲线(10Y-2Y)', rawValue: Math.round(spread * 1000) / 1000, normalizedScore: Math.round(clamp(50 + spread * 40, 10, 90)), weight: w('yieldcurve'), contribution: 0 };
}

// ---------- 主函数 ----------

export function computeQuantScore(params: QuantScoreParams): QuantScoreResult {
  const { closes, vix, dxy, us10y, us2y } = params;

  const factors: QuantScoreResult['factors'] = {};

  if (closes.length >= 20) {
    factors.trend = trendFactor(closes);
    factors.rsi = rsiFactor(closes);
    factors.macd = macdFactor(closes);
    factors.bollinger = bollingerFactor(closes);
    factors.valuation = valuationFactor(closes);
  } else if (closes.length >= 2) {
    // 数据不足 20 天：仅用可算的 RSI/MACD 近似（可能为空则跳过）
    factors.rsi = rsiFactor(closes);
  }

  if (vix && vix.length >= 1) factors.vix = vixFactor(vix);
  if (dxy && dxy.length >= 20) factors.dxy = dxyFactor(dxy);
  if (us10y && us10y.length >= 20) factors.us10y = us10yFactor(us10y);
  if (us10y && us10y.length >= 1 && us2y && us2y.length >= 1) {
    factors.yieldcurve = yieldCurveFactor(us10y[us10y.length - 1] - us2y[us2y.length - 1]);
  }

  const present = Object.values(factors) as QuantFactorDetail[];
  if (present.length === 0) {
    return { score: 50, direction: 'neutral', factors };
  }

  // 按存在的因子重新归一化权重，缺因子不拖低总分
  const sumW = present.reduce((s, f) => s + f.weight, 0) || 1;
  let total = 0;
  for (const f of present) {
    const nw = f.weight / sumW;
    f.contribution = Math.round(f.normalizedScore * nw * 100) / 100;
    total += f.contribution;
  }

  const finalScore = Math.round(clamp(total, 0, 100));
  return {
    score: finalScore,
    direction: finalScore >= 58 ? 'bullish' : finalScore <= 42 ? 'bearish' : 'neutral',
    factors,
  };
}

// ---------- 格式化 ----------

export function formatQuantScoreConsole(result: QuantScoreResult, indent = '  '): string {
  const lines: string[] = [];
  const bar = '─'.repeat(52);
  lines.push(`${indent}🔢 量化评分构成（纯本地计算，零 LLM）`);
  lines.push(`${indent}${bar}`);
  const sumW = (Object.values(result.factors) as QuantFactorDetail[]).reduce((s, f) => s + f.weight, 0) || 1;
  for (const f of Object.values(result.factors) as QuantFactorDetail[]) {
    const pct = Math.round((f.weight / sumW) * 100);
    lines.push(`${indent}  ${f.name.padEnd(18, ' ')} 信号=${String(f.normalizedScore).padStart(3)} × ${String(pct).padStart(2)}%  →  +${f.contribution.toFixed(1)}`);
  }
  lines.push(`${indent}${bar}`);
  const dm: Record<string, string> = { bullish: '📈 偏多', bearish: '📉 偏空', neutral: '➡️ 中性' };
  lines.push(`${indent}  量化综合分 = ${result.score}  ${dm[result.direction]}`);
  return lines.join('\n');
}

export function formatQuantScoreMarkdown(factors: QuantScoreResult['factors'] | undefined, score?: number): string {
  if (!factors || Object.keys(factors).length === 0) return '';
  const present = Object.values(factors) as QuantFactorDetail[];
  const sumW = present.reduce((s, f) => s + f.weight, 0) || 1;
  const lines = [
    '### 量化因子构成（纯本地，零 LLM）',
    '',
    '| 因子 | 信号分 | 权重 | 贡献 |',
    '|------|--------|------|------|',
  ];
  for (const f of present) {
    lines.push(`| ${f.name} | ${f.normalizedScore} | ${Math.round((f.weight / sumW) * 100)}% | +${f.contribution.toFixed(1)} |`);
  }
  if (score != null) lines.push(`| **合计** | | 100% | **${score}** |`);
  lines.push('');
  return lines.join('\n');
}
