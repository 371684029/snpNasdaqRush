import { describe, it, expect } from 'vitest';
import { computeTailRiskIndex } from '../src/utils/tail-risk';

describe('computeTailRiskIndex', () => {
  it('空列表返回 0', () => {
    expect(computeTailRiskIndex([])).toEqual({ index: 0, rawUnion: 0 });
  });

  it('多项高概率不应虚高到接近 100%', () => {
    const risks = [
      { risk: 'a', probability: 40, impact: 'x', trigger: 't', mitigation: 'm' },
      { risk: 'b', probability: 35, impact: 'x', trigger: 't', mitigation: 'm' },
      { risk: 'c', probability: 30, impact: 'x', trigger: 't', mitigation: 'm' },
    ];
    const { index, rawUnion } = computeTailRiskIndex(risks, 50);
    expect(rawUnion).toBeGreaterThan(70);
    expect(index).toBeLessThanOrEqual(50);
    expect(index).toBeLessThan(rawUnion);
  });

  it('单项低风险指数接近该项概率', () => {
    const { index } = computeTailRiskIndex([
      { risk: 'a', probability: 15, impact: 'x', trigger: 't', mitigation: 'm' },
    ]);
    expect(index).toBe(15);
  });

  it('受 maxCap 约束', () => {
    const { index } = computeTailRiskIndex([
      { risk: 'a', probability: 80, impact: 'x', trigger: 't', mitigation: 'm' },
    ], 20);
    expect(index).toBe(20);
  });
});
