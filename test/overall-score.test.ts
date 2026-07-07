// 综合评分一致性单测

import { describe, it, expect } from 'vitest';
import { resolveOverallScore, enforceOverallScore, SCORE_DRIFT_TOLERANCE } from '../src/utils/overall-score.js';

describe('resolveOverallScore', () => {
  it('有反驳修正分时使用修正分', () => {
    const score = resolveOverallScore({ adjustedScore: 65 }, { technical: 80, fundamental: 70, sentiment: 60 });
    expect(score).toBe(65);
  });

  it('无反驳修正分时取三维度均分', () => {
    const score = resolveOverallScore({ adjustedScore: undefined as unknown as number }, { technical: 80, fundamental: 70, sentiment: 60 });
    expect(score).toBe(70);
  });

  it('均分计算正确', () => {
    const score = resolveOverallScore({ adjustedScore: undefined as unknown as number }, { technical: 90, fundamental: 80, sentiment: 70 });
    expect(score).toBe(80);
  });

  it('边界：adjustedScore=0', () => {
    const score = resolveOverallScore({ adjustedScore: 0 }, { technical: 80, fundamental: 80, sentiment: 80 });
    expect(score).toBe(0);
  });

  it('边界：adjustedScore=100', () => {
    const score = resolveOverallScore({ adjustedScore: 100 }, { technical: 10, fundamental: 10, sentiment: 10 });
    expect(score).toBe(100);
  });
});

describe('enforceOverallScore', () => {
  it('始终返回 finalScore 覆盖 LLM score', () => {
    expect(enforceOverallScore(90, 65)).toBe(65);
    expect(enforceOverallScore(undefined, 65)).toBe(65);
  });
});
