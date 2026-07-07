// 历史相似日 — 基于 scenario_features 余弦相似度

import type { ScenarioFeature, PatternMatch } from '../types/calibration.js';
import type { Direction } from '../types/analysis.js';

function dirNum(d: 'up' | 'down' | 'flat'): number {
  if (d === 'up') return 1;
  if (d === 'down') return -1;
  return 0;
}

function stanceNum(s: 'hawkish' | 'dovish' | 'neutral'): number {
  if (s === 'dovish') return 1;
  if (s === 'hawkish') return -1;
  return 0;
}

/** 将特征向量编码为数值数组（固定维度） */
export function featureToVector(f: ScenarioFeature): number[] {
  return [
    dirNum(f.dollarDirection) * Math.min(Math.abs(f.dollarMagnitude) / 2, 1),
    dirNum(f.tipsDirection) * Math.min(Math.abs(f.tipsMagnitude) / 2, 1),
    Math.min(f.vixLevel, 40) / 40,
    stanceNum(f.fedStance),
    dirNum(f.momentumDirection),
  ];
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface SimilaritySearchOptions {
  topK?: number;
  minSimilarity?: number;
  excludeDate?: string;
  filledOnly?: boolean;
}

/** 查找与当前特征最相似的历史日 */
export function findSimilarPatterns(
  current: ScenarioFeature,
  history: ScenarioFeature[],
  scoreByReportId: Map<number, { score: number; direction: Direction }>,
  options: SimilaritySearchOptions = {},
): PatternMatch[] {
  const topK = options.topK ?? 5;
  const minSim = options.minSimilarity ?? 0.55;
  const curVec = featureToVector(current);

  const matches: PatternMatch[] = [];

  for (const h of history) {
    if (options.excludeDate && h.date === options.excludeDate) continue;
    if (h.id === current.id) continue;
    if (options.filledOnly && h.backfillStatus !== 'filled') continue;

    const sim = cosineSimilarity(curVec, featureToVector(h));
    if (sim < minSim) continue;

    const meta = scoreByReportId.get(h.reportId);
    matches.push({
      date: h.date,
      reportId: h.reportId,
      similarity: Math.round(sim * 1000) / 1000,
      direction: meta?.direction ?? 'neutral',
      score: meta?.score ?? 0,
      actualReturn: h.actual5dReturn,
      actual5dReturn: h.actual5dReturn,
    });
  }

  matches.sort((a, b) => b.similarity - a.similarity);
  return matches.slice(0, topK);
}
