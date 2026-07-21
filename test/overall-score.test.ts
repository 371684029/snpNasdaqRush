import { describe, it, expect } from 'vitest';
import { resolveOverallScore, enforceOverallScore } from '../src/utils/overall-score';

describe('resolveOverallScore', () => {
  it('优先使用 adjustedScore', () => {
    expect(resolveOverallScore(
      { adjustedScore: 64 },
      { technical: 70, fundamental: 72, sentiment: 68 },
    )).toBe(64);
  });

  it('无修正时用三维度均分', () => {
    expect(resolveOverallScore(
      {},
      { technical: 60, fundamental: 90, sentiment: 30 },
    )).toBe(60);
  });
});

describe('enforceOverallScore', () => {
  it('始终返回 finalScore', () => {
    expect(enforceOverallScore(80, 64)).toBe(64);
    expect(enforceOverallScore(undefined, 55)).toBe(55);
  });
});
