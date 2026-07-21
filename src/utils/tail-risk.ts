// 尾部风险指数 — 互斥修正，避免多项高概率叠加虚高

import type { TailRisk } from '../types/analysis.js';

export interface TailRiskIndexResult {
  /** 展示用综合指数（%） */
  index: number;
  /** 朴素并概率（至少一项发生），供参考 */
  rawUnion: number;
}

/**
 * 计算尾部风险指数。
 * LLM 输出的多项 tailRisk 概率往往相关/重叠，朴素 1-∏(1-p) 易飙到 90%+。
 * 采用「最高单项 + 次要项递减贡献」与朴素并概率取 min，并受 maxCap 约束。
 */
export function computeTailRiskIndex(
  risks: TailRisk[],
  maxCap: number = 50,
): TailRiskIndexResult {
  if (risks.length === 0) {
    return { index: 0, rawUnion: 0 };
  }

  const probs = risks.map(r => Math.max(0, Math.min(100, r.probability ?? 0)));
  const rawUnion = (1 - probs.reduce((p, prob) => p * (1 - prob / 100), 1)) * 100;

  const sorted = [...probs].sort((a, b) => b - a);
  const maxProb = sorted[0];
  const secondaryContribution = sorted
    .slice(1)
    .reduce((sum, p, i) => sum + p * Math.pow(0.5, i + 1), 0);

  const dampened = Math.min(rawUnion, maxProb + secondaryContribution * 0.3);
  const index = Math.round(Math.min(dampened, maxCap) * 10) / 10;

  return {
    index,
    rawUnion: Math.round(rawUnion * 10) / 10,
  };
}
