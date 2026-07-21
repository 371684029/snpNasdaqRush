import { describe, it, expect } from 'vitest';
import {
  adjustScoreWithRebuttal,
  calibrateStrengthMultiplier,
  computeRebuttalAdjustment,
  STRENGTH_MULTIPLIER,
} from '../src/utils/rebuttal-score';

describe('adjustScoreWithRebuttal', () => {
  it('典型偏多 + 中等反驳应下调综合分', () => {
    const { adjustedScore } = adjustScoreWithRebuttal(70, 42, 'moderate');
    expect(adjustedScore).toBeGreaterThanOrEqual(64);
    expect(adjustedScore).toBeLessThanOrEqual(68);
  });

  it('强看空反驳不应错误抬高偏多分（59 + bear71 strong）', () => {
    const { adjustedScore, netEffect } = adjustScoreWithRebuttal(59, 71, 'strong');
    expect(adjustedScore).toBeLessThan(59);
    expect(netEffect).not.toBe('unchanged');
  });

  it('强看多 + 强反驳应显著下调', () => {
    const { adjustedScore } = adjustScoreWithRebuttal(82, 55, 'strong');
    expect(adjustedScore).toBeLessThan(82);
    expect(adjustedScore).toBeGreaterThanOrEqual(65);
  });

  it('弱反驳几乎不修正', () => {
    const { adjustedScore } = adjustScoreWithRebuttal(58, 45, 'weak');
    expect(Math.abs(adjustedScore - 58)).toBeLessThanOrEqual(2);
  });

  it('结果 clamp 在 0-100', () => {
    const low = adjustScoreWithRebuttal(5, 95, 'strong');
    const high = adjustScoreWithRebuttal(95, 5, 'weak');
    expect(low.adjustedScore).toBeGreaterThanOrEqual(0);
    expect(high.adjustedScore).toBeLessThanOrEqual(100);
  });

  it('偏乐观时在线校准增大乘数，进一步压低分数', () => {
    const base = computeRebuttalAdjustment(70, 60, 'strong');
    const cal = computeRebuttalAdjustment(70, 60, 'strong', {
      systematicBias: '偏乐观',
      calibrationError: 20,
      sampleSize: 8,
    });
    expect(cal.multiplier).toBeGreaterThan(base.multiplier);
    expect(cal.adjustedScore).toBeLessThanOrEqual(base.adjustedScore);
  });
});

describe('calibrateStrengthMultiplier', () => {
  it('样本不足不调整', () => {
    expect(calibrateStrengthMultiplier(0.35, {
      systematicBias: '偏乐观',
      calibrationError: 20,
      sampleSize: 2,
    })).toBe(0.35);
  });

  it('偏悲观时略减乘数', () => {
    const next = calibrateStrengthMultiplier(STRENGTH_MULTIPLIER.strong, {
      systematicBias: '偏悲观',
      calibrationError: 20,
      sampleSize: 10,
    });
    expect(next).toBeLessThan(STRENGTH_MULTIPLIER.strong);
    expect(next).toBeGreaterThanOrEqual(0.05);
  });
});
