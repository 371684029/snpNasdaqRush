// 情景概率统计化 — 基于历史 SPX/IXIC 5 日收益分布
// 对齐 goldRush 的 computeScenarioProbabilities，但用本地价格序列代替特征向量匹配
//
// goldRush 版依赖 PatternMatch + 7 维余弦相似度
// snpRush 简化版：用近 60 日滚动 5 日收益分布推断情景概率

import type { IndexPriceRecord } from '../types/market.js';

export interface ScenarioProbabilities {
  base: number;
  upside: number;
  downside: number;
  sampleSize: number;
  source: 'historical' | 'insufficient';
  note: string;
}

const UPSIDE_THRESHOLD = 1.0;   // 5 日涨幅 ≥1%
const DOWNSIDE_THRESHOLD = -1.0; // 5 日跌幅 ≤-1%

/** 从价格序列计算 5 日滚动收益分布，推断三情景概率 */
export function computeHistoricalScenarioProbs(prices: IndexPriceRecord[]): ScenarioProbabilities {
  // 计算 5 日滚动收益（必须间隔恰好 5 个交易日）
  const returns: number[] = [];
  for (let i = 5; i < prices.length; i++) {
    const prev = prices[i - 5]?.spxClose;
    const curr = prices[i]?.spxClose;
    if (prev && curr && prev > 0) {
      returns.push(((curr - prev) / prev) * 100);
    }
  }

  if (returns.length < 3) {
    return {
      base: 50,
      upside: 25,
      downside: 25,
      sampleSize: returns.length,
      source: 'insufficient',
      note: `历史 5 日收益样本 ${returns.length} 不足 3，保留默认概率`,
    };
  }

  let up = 0, down = 0, base = 0;
  for (const r of returns) {
    if (r >= UPSIDE_THRESHOLD) up++;
    else if (r <= DOWNSIDE_THRESHOLD) down++;
    else base++;
  }

  const n = returns.length;
  let pUp = Math.round((up / n) * 100);
  let pDown = Math.round((down / n) * 100);
  let pBase = 100 - pUp - pDown;

  // 下行情景不得低于 15%
  if (pDown < 15) {
    const need = 15 - pDown;
    pDown = 15;
    pBase = Math.max(0, pBase - need);
    if (pUp + pBase + pDown > 100) pUp = 100 - pDown - pBase;
  }

  // 确保 sum=100
  const sum = pBase + pUp + pDown;
  if (sum !== 100) {
    pBase += 100 - sum;
  }

  return {
    base: pBase,
    upside: pUp,
    downside: pDown,
    sampleSize: n,
    source: 'historical',
    note: `基于 ${n} 个 SPX 5 日滚动收益窗口（涨≥${UPSIDE_THRESHOLD}%/跌≤${DOWNSIDE_THRESHOLD}%）`,
  };
}

/** 格式化一行文本 */
export function formatScenarioProbLine(probs: ScenarioProbabilities): string {
  if (probs.source === 'historical') {
    return `历史分布概率（${probs.note}）：基准 ${probs.base}% / 上行 ${probs.upside}% / 下行 ${probs.downside}%`;
  }
  return probs.note;
}
