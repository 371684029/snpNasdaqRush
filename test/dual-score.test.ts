import { describe, it, expect } from 'vitest';
import { evaluateDualScore, dualDirectionFromScore } from '../src/utils/dual-score';

describe('dualDirectionFromScore', () => {
  it('阈值：>=58 偏多 / <=42 偏空 / 其余中性', () => {
    expect(dualDirectionFromScore(60)).toBe('bullish');
    expect(dualDirectionFromScore(40)).toBe('bearish');
    expect(dualDirectionFromScore(50)).toBe('neutral');
  });
});

describe('evaluateDualScore — 双打分裁决', () => {
  it('偏差≤8 且同向 → aligned / both', () => {
    const v = evaluateDualScore(62, 58);
    expect(v.alignment).toBe('aligned');
    expect(v.actionPolicy).toBe('both');
    expect(v.delta).toBe(4);
    expect(v.actionOverride).toBeNull();
  });

  it('偏差>15 → conflict / 弃权 + 操作覆盖', () => {
    const v = evaluateDualScore(70, 40);
    expect(v.alignment).toBe('conflict');
    expect(v.actionPolicy).toBe('hold_on_conflict');
    expect(v.actionOverride).not.toBeNull();
  });

  it('温和偏差(8<Δ≤15)且同向 → mild_gap / quant_preferred', () => {
    const v = evaluateDualScore(70, 59);
    expect(v.alignment).toBe('mild_gap');
    expect(v.actionPolicy).toBe('quant_preferred');
  });

  it('缺量化分 → quant_missing / llm_only', () => {
    const v = evaluateDualScore(60, null);
    expect(v.alignment).toBe('quant_missing');
    expect(v.actionPolicy).toBe('llm_only');
    expect(v.quantScore).toBeNull();
  });

  it('维度一致性弱 → 弃权', () => {
    const v = evaluateDualScore(62, 60, { consistencyWeak: true });
    expect(v.actionPolicy).toBe('hold_on_conflict');
  });
});
