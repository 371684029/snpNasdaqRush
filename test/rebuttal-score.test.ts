// 反驳评分修正单测

import { describe, it, expect } from 'vitest';
import { computeRebuttalAdjustment, adjustScoreWithRebuttal } from '../src/utils/rebuttal-score.js';

describe('computeRebuttalAdjustment', () => {
  it('看空力度高于均分时下调（bearDiff→bearishImpliedScore 公式）', () => {
    // bearishImpliedScore = 100 - 80 = 20；raw = (20-70)*0.35 = -17.5；round(70-17.5)=53
    const r = computeRebuttalAdjustment(70, 80, 'strong');
    expect(r.adjustedScore).toBe(53);
    expect(r.netEffect).toBe('significant_downgrade');
    expect(r.bearishImpliedScore).toBe(20);
  });

  it('看空力度低于均分时不反向抬分（bearDiff=0，bearishImpliedScore=70→raw=0）', () => {
    const r = computeRebuttalAdjustment(70, 30, 'strong');
    expect(r.adjustedScore).toBe(70);
    expect(r.netEffect).toBe('unchanged');
  });

  it('weak 强度下调幅度小', () => {
    // bearishImpliedScore = 100-90=10, raw=(10-70)*0.10=-6, adj=64
    const r = computeRebuttalAdjustment(70, 90, 'weak');
    expect(r.adjustedScore).toBe(64);
    expect(r.netEffect).toBe('significant_downgrade');
  });

  it('moderate 强度中等下调', () => {
    // bearishImpliedScore=10, raw=(10-70)*0.20=-12, adj=58
    const r = computeRebuttalAdjustment(70, 90, 'moderate');
    expect(r.adjustedScore).toBe(58);
  });

  it('strong 强度大幅下调', () => {
    // bearishImpliedScore=10, raw=(10-70)*0.35=-21, adj=49
    const r = computeRebuttalAdjustment(70, 90, 'strong');
    expect(r.adjustedScore).toBe(49);
  });

  it('边界：originalScore=0', () => {
    // bearishImpliedScore=0, raw=(0-0)*0.35=0, adj=0
    const r = computeRebuttalAdjustment(0, 100, 'strong');
    expect(r.adjustedScore).toBe(0);
    expect(r.netEffect).toBe('unchanged');
  });

  it('边界：originalScore=100', () => {
    // bearishImpliedScore=0, raw=(0-100)*0.35=-35, adj=65
    const r = computeRebuttalAdjustment(100, 100, 'strong');
    expect(r.adjustedScore).toBe(65);
    expect(r.netEffect).toBe('significant_downgrade');
  });

  it('adjustScoreWithRebuttal 返回一致结果', () => {
    const r = adjustScoreWithRebuttal(70, 80, 'strong');
    expect(r.adjustedScore).toBeLessThan(70);
    expect(r.netEffect).toBe('significant_downgrade');
  });
});
