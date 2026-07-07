// 综合评分一致性 — 反驳修正分优先

import type { RebuttalAnalysis } from '../types/analysis.js';

export interface DimensionScores {
  technical: number;
  fundamental: number;
  sentiment: number;
}

/**
 * 最终综合分：以反驳修正后的 adjustedScore 为准；
 * 无修正时取三维度均分。
 */
export function resolveOverallScore(
  rebuttal: Pick<RebuttalAnalysis, 'adjustedScore'>,
  dimensions: DimensionScores,
): number {
  if (rebuttal.adjustedScore != null && Number.isFinite(rebuttal.adjustedScore)) {
    return Math.max(0, Math.min(100, Math.round(rebuttal.adjustedScore)));
  }
  const avg = (dimensions.technical + dimensions.fundamental + dimensions.sentiment) / 3;
  return Math.max(0, Math.min(100, Math.round(avg)));
}

/** 编排 LLM 允许微调的上限（分） */
export const SCORE_DRIFT_TOLERANCE = 3;

/** 强制使用反驳修正后的最终分（忽略 LLM 自打分） */
export function enforceOverallScore(_llmScore: number | undefined, finalScore: number): number {
  return finalScore;
}
